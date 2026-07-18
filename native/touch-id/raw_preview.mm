#import <CoreGraphics/CoreGraphics.h>
#import <CoreImage/CoreImage.h>
#import <Foundation/Foundation.h>
#import <ImageIO/ImageIO.h>

#include <napi.h>

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace {

constexpr std::size_t kMaxHeicInputBytes = 256U * 1024U * 1024U;

void SecureClear(std::vector<std::uint8_t>& bytes) {
  volatile std::uint8_t* cursor = bytes.data();
  for (std::size_t index = 0; index < bytes.size(); ++index) cursor[index] = 0;
  bytes.clear();
}

bool HasBrand(const std::vector<std::uint8_t>& bytes, std::string_view wanted) {
  if (bytes.size() < 16 || std::memcmp(bytes.data() + 4, "ftyp", 4) != 0) return false;
  const std::uint32_t boxSize = (static_cast<std::uint32_t>(bytes[0]) << 24U) |
                                (static_cast<std::uint32_t>(bytes[1]) << 16U) |
                                (static_cast<std::uint32_t>(bytes[2]) << 8U) | static_cast<std::uint32_t>(bytes[3]);
  const std::size_t limit = std::min<std::size_t>(boxSize, bytes.size());
  for (std::size_t offset = 8; offset + 4 <= limit; offset += 4) {
    if (std::memcmp(bytes.data() + offset, wanted.data(), 4) == 0) return true;
  }
  return false;
}

bool LooksLikeHeif(const std::vector<std::uint8_t>& bytes) {
  static constexpr std::string_view brands[] = {
      "heic", "heix", "heim", "heis", "hevc", "hevx", "mif1", "msf1", "avif", "avis",
  };
  return std::any_of(std::begin(brands), std::end(brands), [&](std::string_view brand) { return HasBrand(bytes, brand); });
}

std::string FailureCode(CGImageSourceStatus status) {
  if (status == kCGImageStatusUnknownType) return "HEIC_UNSUPPORTED_CODEC";
  if (status == kCGImageStatusUnexpectedEOF || status == kCGImageStatusInvalidData || status == kCGImageStatusIncomplete) {
    return "HEIC_CORRUPT";
  }
  return "HEIC_DECODE_FAILED";
}

class DecodeWorker final : public Napi::AsyncWorker {
 public:
  DecodeWorker(Napi::Env env, std::vector<std::uint8_t> input, std::uint32_t maxEdge)
      : Napi::AsyncWorker(env), deferred_(Napi::Promise::Deferred::New(env)), input_(std::move(input)), maxEdge_(maxEdge) {}

  ~DecodeWorker() override {
    SecureClear(input_);
    SecureClear(output_);
  }

  Napi::Promise Promise() const { return deferred_.Promise(); }

  void Execute() override {
    @autoreleasepool {
      NSData* data = [NSData dataWithBytesNoCopy:input_.data() length:input_.size() freeWhenDone:NO];
      CIRAWFilter* filter = [CIRAWFilter filterWithImageData:data identifierHint:nil];
      CIImage* image = filter.outputImage;
      if (filter == nil || image == nil) {
        SecureClear(input_);
        SetError("unsupported or corrupt RAW image");
        return;
      }

      CGRect extent = image.extent;
      if (CGRectIsEmpty(extent) || CGRectIsInfinite(extent) || !std::isfinite(extent.size.width) ||
          !std::isfinite(extent.size.height) || extent.size.width <= 0 || extent.size.height <= 0) {
        SecureClear(input_);
        SetError("RAW image has invalid dimensions");
        return;
      }

      const CGFloat longest = std::max(extent.size.width, extent.size.height);
      if (longest > static_cast<CGFloat>(maxEdge_)) {
        const CGFloat scale = static_cast<CGFloat>(maxEdge_) / longest;
        image = [image imageByApplyingTransform:CGAffineTransformMakeScale(scale, scale)];
        extent = image.extent;
      }

      CGColorSpaceRef colorSpace = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
      CIContext* context = [CIContext contextWithOptions:@{
        kCIContextWorkingColorSpace : (__bridge id)colorSpace,
        kCIContextOutputColorSpace : (__bridge id)colorSpace,
        kCIContextCacheIntermediates : @NO,
      }];
      CGImageRef rendered = [context createCGImage:image fromRect:extent format:kCIFormatRGBA8 colorSpace:colorSpace];
      CGColorSpaceRelease(colorSpace);
      if (rendered == nullptr) {
        SecureClear(input_);
        SetError("Core Image could not render RAW pixels");
        return;
      }

      CFMutableDataRef jpeg = CFDataCreateMutable(kCFAllocatorDefault, 0);
      CGImageDestinationRef destination =
          CGImageDestinationCreateWithData(jpeg, CFSTR("public.jpeg"), 1, nullptr);
      if (destination != nullptr) {
        const NSDictionary* properties = @{(__bridge NSString*)kCGImageDestinationLossyCompressionQuality : @0.92};
        CGImageDestinationAddImage(destination, rendered, (__bridge CFDictionaryRef)properties);
      }
      const bool finalized = destination != nullptr && CGImageDestinationFinalize(destination);
      if (destination != nullptr) CFRelease(destination);
      CGImageRelease(rendered);
      SecureClear(input_);
      if (!finalized) {
        CFRelease(jpeg);
        SetError("Core Image RAW JPEG encoding failed");
        return;
      }

      const CFIndex length = CFDataGetLength(jpeg);
      const std::uint8_t* bytes = CFDataGetBytePtr(jpeg);
      if (length <= 0 || bytes == nullptr) {
        CFRelease(jpeg);
        SetError("Core Image returned an empty RAW preview");
        return;
      }
      output_.assign(bytes, bytes + length);
      CFRelease(jpeg);
    }
  }

  void OnOK() override {
    Napi::Buffer<std::uint8_t> output = Napi::Buffer<std::uint8_t>::Copy(Env(), output_.data(), output_.size());
    SecureClear(output_);
    deferred_.Resolve(output);
  }

  void OnError(const Napi::Error& error) override { deferred_.Reject(error.Value()); }

 private:
  Napi::Promise::Deferred deferred_;
  std::vector<std::uint8_t> input_;
  std::vector<std::uint8_t> output_;
  const std::uint32_t maxEdge_;
};

class HeicDecodeWorker final : public Napi::AsyncWorker {
 public:
  HeicDecodeWorker(Napi::Env env, std::vector<std::uint8_t> input, std::uint32_t maxEdge)
      : Napi::AsyncWorker(env), deferred_(Napi::Promise::Deferred::New(env)), input_(std::move(input)), maxEdge_(maxEdge) {}

  ~HeicDecodeWorker() override {
    SecureClear(input_);
    SecureClear(output_);
  }

  Napi::Promise Promise() const { return deferred_.Promise(); }

  void Execute() override {
    @autoreleasepool {
      NSData* data = [NSData dataWithBytesNoCopy:input_.data() length:input_.size() freeWhenDone:NO];
      CGImageSourceRef source = CGImageSourceCreateWithData((__bridge CFDataRef)data, nullptr);
      if (source == nullptr) {
        Fail(LooksLikeHeif(input_) ? "macOS has no decoder for this HEIF codec" : "corrupt HEIC container",
             LooksLikeHeif(input_) ? "HEIC_UNSUPPORTED_CODEC" : "HEIC_CORRUPT");
        SecureClear(input_);
        return;
      }

      const CGImageSourceStatus initialStatus = CGImageSourceGetStatus(source);
      if (initialStatus < kCGImageStatusIncomplete) {
        CFRelease(source);
        Fail("HEIC image source is invalid", FailureCode(initialStatus));
        SecureClear(input_);
        return;
      }

      const NSDictionary* thumbnailOptions = @{
        (__bridge NSString*)kCGImageSourceCreateThumbnailFromImageAlways : @YES,
        (__bridge NSString*)kCGImageSourceCreateThumbnailWithTransform : @YES,
        (__bridge NSString*)kCGImageSourceThumbnailMaxPixelSize : @(maxEdge_),
        (__bridge NSString*)kCGImageSourceShouldCacheImmediately : @YES,
      };
      CGImageRef thumbnail =
          CGImageSourceCreateThumbnailAtIndex(source, 0, (__bridge CFDictionaryRef)thumbnailOptions);
      const CGImageSourceStatus decodedStatus = CGImageSourceGetStatusAtIndex(source, 0);
      CFRelease(source);
      SecureClear(input_);
      if (thumbnail == nullptr) {
        Fail("macOS could not decode HEIC pixels", FailureCode(decodedStatus));
        return;
      }

      width_ = static_cast<std::uint32_t>(CGImageGetWidth(thumbnail));
      height_ = static_cast<std::uint32_t>(CGImageGetHeight(thumbnail));

      CFMutableDataRef jpeg = CFDataCreateMutable(kCFAllocatorDefault, 0);
      CGImageDestinationRef destination =
          CGImageDestinationCreateWithData(jpeg, CFSTR("public.jpeg"), 1, nullptr);
      if (destination != nullptr) {
        const NSDictionary* properties = @{(__bridge NSString*)kCGImageDestinationLossyCompressionQuality : @0.92};
        // A CGImage has pixels and color-space information only: source EXIF,
        // GPS, and orientation metadata cannot cross this derivative boundary.
        CGImageDestinationAddImage(destination, thumbnail, (__bridge CFDictionaryRef)properties);
      }
      const bool finalized = destination != nullptr && CGImageDestinationFinalize(destination);
      if (destination != nullptr) CFRelease(destination);
      CGImageRelease(thumbnail);
      if (!finalized) {
        CFRelease(jpeg);
        Fail("HEIC JPEG encoding failed", "HEIC_DECODE_FAILED");
        return;
      }

      const CFIndex length = CFDataGetLength(jpeg);
      const std::uint8_t* bytes = CFDataGetBytePtr(jpeg);
      if (length <= 0 || bytes == nullptr || width_ == 0 || height_ == 0) {
        CFRelease(jpeg);
        Fail("macOS returned an empty HEIC preview", "HEIC_DECODE_FAILED");
        return;
      }
      output_.assign(bytes, bytes + length);
      CFRelease(jpeg);
    }
  }

  void OnOK() override {
    Napi::Object result = Napi::Object::New(Env());
    result.Set("bytes", Napi::Buffer<std::uint8_t>::Copy(Env(), output_.data(), output_.size()));
    result.Set("width", Napi::Number::New(Env(), width_));
    result.Set("height", Napi::Number::New(Env(), height_));
    SecureClear(output_);
    deferred_.Resolve(result);
  }

  void OnError(const Napi::Error& error) override {
    Napi::Object value = error.Value();
    value.Set("code", failureCode_);
    deferred_.Reject(value);
  }

 private:
  void Fail(const std::string& message, const std::string& code) {
    failureCode_ = code;
    SetError(message);
  }

  Napi::Promise::Deferred deferred_;
  std::vector<std::uint8_t> input_;
  std::vector<std::uint8_t> output_;
  const std::uint32_t maxEdge_;
  std::uint32_t width_ = 0;
  std::uint32_t height_ = 0;
  std::string failureCode_ = "HEIC_DECODE_FAILED";
};

Napi::Value Decode(const Napi::CallbackInfo& info) {
  if (info.Length() < 1 || !info[0].IsBuffer()) {
    Napi::TypeError::New(info.Env(), "RAW bytes must be a Buffer").ThrowAsJavaScriptException();
    return info.Env().Undefined();
  }
  const Napi::Buffer<std::uint8_t> input = info[0].As<Napi::Buffer<std::uint8_t>>();
  if (input.Length() == 0) {
    Napi::RangeError::New(info.Env(), "RAW bytes must not be empty").ThrowAsJavaScriptException();
    return info.Env().Undefined();
  }
  std::uint32_t maxEdge = 4096;
  if (info.Length() > 1 && info[1].IsNumber()) maxEdge = info[1].As<Napi::Number>().Uint32Value();
  if (maxEdge < 512 || maxEdge > 8192) {
    Napi::RangeError::New(info.Env(), "maxEdge must be between 512 and 8192").ThrowAsJavaScriptException();
    return info.Env().Undefined();
  }
  auto* worker = new DecodeWorker(info.Env(), {input.Data(), input.Data() + input.Length()}, maxEdge);
  const Napi::Promise promise = worker->Promise();
  worker->Queue();
  return promise;
}

Napi::Value DecodeHeic(const Napi::CallbackInfo& info) {
  if (info.Length() < 1 || !info[0].IsBuffer()) {
    Napi::TypeError::New(info.Env(), "HEIC bytes must be a Buffer").ThrowAsJavaScriptException();
    return info.Env().Undefined();
  }
  const Napi::Buffer<std::uint8_t> input = info[0].As<Napi::Buffer<std::uint8_t>>();
  if (input.Length() == 0) {
    Napi::RangeError::New(info.Env(), "HEIC bytes must not be empty").ThrowAsJavaScriptException();
    return info.Env().Undefined();
  }
  if (input.Length() > kMaxHeicInputBytes) {
    Napi::RangeError::New(info.Env(), "HEIC input exceeds the 256 MiB decode limit").ThrowAsJavaScriptException();
    return info.Env().Undefined();
  }
  std::uint32_t maxEdge = 4096;
  if (info.Length() > 1 && info[1].IsNumber()) maxEdge = info[1].As<Napi::Number>().Uint32Value();
  if (maxEdge < 512 || maxEdge > 8192) {
    Napi::RangeError::New(info.Env(), "maxEdge must be between 512 and 8192").ThrowAsJavaScriptException();
    return info.Env().Undefined();
  }
  auto* worker = new HeicDecodeWorker(info.Env(), {input.Data(), input.Data() + input.Length()}, maxEdge);
  const Napi::Promise promise = worker->Promise();
  worker->Queue();
  return promise;
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("decode", Napi::Function::New(env, Decode));
  exports.Set("decodeHeic", Napi::Function::New(env, DecodeHeic));
  return exports;
}

}  // namespace

NODE_API_MODULE(overlook_raw_preview, Init)
