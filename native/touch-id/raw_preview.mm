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
#include <utility>
#include <vector>

namespace {

void SecureClear(std::vector<std::uint8_t>& bytes) {
  volatile std::uint8_t* cursor = bytes.data();
  for (std::size_t index = 0; index < bytes.size(); ++index) cursor[index] = 0;
  bytes.clear();
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

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("decode", Napi::Function::New(env, Decode));
  return exports;
}

}  // namespace

NODE_API_MODULE(overlook_raw_preview, Init)
