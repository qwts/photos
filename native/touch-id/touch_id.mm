#import <Foundation/Foundation.h>
#import <LocalAuthentication/LocalAuthentication.h>
#import <Security/SecCode.h>
#import <Security/Security.h>

#include <napi.h>

#include <cstdint>
#include <string>
#include <utility>
#include <vector>

namespace {

constexpr const char* kService = "com.zts1.overlook.touch-id-unlock";
constexpr const char* kExpectedTeamIdentifier = "Z5DM34QS5U";
constexpr const char* kExpectedApplicationIdentifier = "Z5DM34QS5U.com.zts1.overlook";

void SecureClear(std::vector<std::uint8_t>& bytes) {
  volatile std::uint8_t* cursor = bytes.data();
  for (std::size_t index = 0; index < bytes.size(); ++index) cursor[index] = 0;
  bytes.clear();
}

NSString* String(const std::string& value) {
  return [[NSString alloc] initWithBytes:value.data() length:value.size() encoding:NSUTF8StringEncoding];
}

bool HasTrustedSignature(const std::string& expectedBundleId) {
  @autoreleasepool {
    NSString* expected = String(expectedBundleId);
    NSString* bundleId = NSBundle.mainBundle.bundleIdentifier;
    if (expected == nil || bundleId == nil || ![bundleId isEqualToString:expected]) return false;

    SecCodeRef code = nullptr;
    if (SecCodeCopySelf(kSecCSDefaultFlags, &code) != errSecSuccess || code == nullptr) return false;
    const OSStatus validity = SecCodeCheckValidity(code, kSecCSStrictValidate, nullptr);
    if (validity != errSecSuccess) {
      CFRelease(code);
      return false;
    }

    CFDictionaryRef information = nullptr;
    const OSStatus copied = SecCodeCopySigningInformation(code, kSecCSSigningInformation, &information);
    CFRelease(code);
    if (copied != errSecSuccess || information == nullptr) return false;

    const auto* identifier = static_cast<CFStringRef>(CFDictionaryGetValue(information, kSecCodeInfoIdentifier));
    const auto* teamIdentifier = static_cast<CFStringRef>(CFDictionaryGetValue(information, kSecCodeInfoTeamIdentifier));
    const auto* entitlements = static_cast<CFDictionaryRef>(CFDictionaryGetValue(information, kSecCodeInfoEntitlementsDict));
    const auto* flagsValue = static_cast<CFNumberRef>(CFDictionaryGetValue(information, kSecCodeInfoFlags));
    if (identifier == nullptr || teamIdentifier == nullptr || entitlements == nullptr || flagsValue == nullptr ||
        CFGetTypeID(identifier) != CFStringGetTypeID() || CFGetTypeID(teamIdentifier) != CFStringGetTypeID() ||
        CFGetTypeID(entitlements) != CFDictionaryGetTypeID() || CFGetTypeID(flagsValue) != CFNumberGetTypeID() ||
        CFStringGetLength(teamIdentifier) == 0) {
      CFRelease(information);
      return false;
    }
    std::uint32_t flags = 0;
    CFNumberGetValue(flagsValue, kCFNumberSInt32Type, &flags);
    const auto* applicationIdentifier = static_cast<CFStringRef>(
        CFDictionaryGetValue(entitlements, CFSTR("com.apple.application-identifier")));
    const auto* entitlementTeam =
        static_cast<CFStringRef>(CFDictionaryGetValue(entitlements, CFSTR("com.apple.developer.team-identifier")));
    NSString* expectedTeamIdentifier = String(kExpectedTeamIdentifier);
    NSString* expectedApplicationIdentifier = String(kExpectedApplicationIdentifier);
    const bool valid = applicationIdentifier != nullptr && entitlementTeam != nullptr &&
                       expectedTeamIdentifier != nil && expectedApplicationIdentifier != nil &&
                       CFGetTypeID(applicationIdentifier) == CFStringGetTypeID() &&
                       CFGetTypeID(entitlementTeam) == CFStringGetTypeID() &&
                       CFStringCompare(identifier, (__bridge CFStringRef)expected, 0) == kCFCompareEqualTo &&
                       CFStringCompare(teamIdentifier, (__bridge CFStringRef)expectedTeamIdentifier, 0) == kCFCompareEqualTo &&
                       CFStringCompare(applicationIdentifier, (__bridge CFStringRef)expectedApplicationIdentifier, 0) ==
                           kCFCompareEqualTo &&
                       CFStringCompare(entitlementTeam, (__bridge CFStringRef)expectedTeamIdentifier, 0) == kCFCompareEqualTo &&
                       (flags & kSecCodeSignatureAdhoc) == 0;
    CFRelease(information);
    return valid;
  }
}

struct AvailabilityResult {
  bool available;
  std::string reason;
};

AvailabilityResult CheckAvailability(const std::string& expectedBundleId) {
  @autoreleasepool {
    if (!HasTrustedSignature(expectedBundleId)) return {false, "unsigned-build"};
    LAContext* context = [[LAContext alloc] init];
    NSError* error = nil;
    if (![context canEvaluatePolicy:LAPolicyDeviceOwnerAuthenticationWithBiometrics error:&error]) {
      if (error.code == LAErrorBiometryNotEnrolled) return {false, "not-enrolled"};
      if (error.code == LAErrorBiometryLockout) return {false, "locked-out"};
      return {false, "unavailable"};
    }
    if (context.biometryType != LABiometryTypeTouchID) return {false, "unavailable"};
    return {true, ""};
  }
}

NSMutableDictionary* BaseQuery(const std::string& account) {
  return [@{
    (__bridge id)kSecClass : (__bridge id)kSecClassGenericPassword,
    (__bridge id)kSecAttrService : String(kService),
    (__bridge id)kSecAttrAccount : String(account),
    (__bridge id)kSecAttrSynchronizable : @NO,
    (__bridge id)kSecUseDataProtectionKeychain : @YES,
  } mutableCopy];
}

std::string ReadErrorCode(OSStatus status) {
  switch (status) {
    case errSecUserCanceled:
      return "cancelled";
    case errSecAuthFailed:
      return "failed";
    case errSecItemNotFound:
      return "missing";
    case errSecInteractionNotAllowed:
    case errSecNotAvailable:
      return "unavailable";
    default:
      return "storage-failure";
  }
}

class PromiseWorker : public Napi::AsyncWorker {
 public:
  PromiseWorker(Napi::Env env, std::string expectedBundleId, std::string account)
      : Napi::AsyncWorker(env), deferred_(Napi::Promise::Deferred::New(env)), expectedBundleId_(std::move(expectedBundleId)),
        account_(std::move(account)) {}

  Napi::Promise Promise() const { return deferred_.Promise(); }

 protected:
  void Fail(std::string code) {
    errorCode_ = std::move(code);
    SetError("Touch ID operation failed");
  }

  void OnError(const Napi::Error& error) override {
    Napi::Object value = error.Value();
    value.Set("code", Napi::String::New(Env(), errorCode_.empty() ? "unavailable" : errorCode_));
    deferred_.Reject(value);
  }

  Napi::Promise::Deferred deferred_;
  const std::string expectedBundleId_;
  const std::string account_;

 private:
  std::string errorCode_;
};

class StoreWorker final : public PromiseWorker {
 public:
  StoreWorker(Napi::Env env, std::string expectedBundleId, std::string account, std::vector<std::uint8_t> secret)
      : PromiseWorker(env, std::move(expectedBundleId), std::move(account)), secret_(std::move(secret)) {}

  ~StoreWorker() override { SecureClear(secret_); }

  void Execute() override {
    @autoreleasepool {
      const AvailabilityResult availability = CheckAvailability(expectedBundleId_);
      if (!availability.available) {
        Fail(availability.reason == "locked-out" ? "locked-out" : "unavailable");
        return;
      }
      NSMutableDictionary* query = BaseQuery(account_);
      const OSStatus removed = SecItemDelete((__bridge CFDictionaryRef)query);
      if (removed != errSecSuccess && removed != errSecItemNotFound) {
        Fail("storage-failure");
        return;
      }

      CFErrorRef accessError = nullptr;
      SecAccessControlRef access = SecAccessControlCreateWithFlags(
          kCFAllocatorDefault, kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly, kSecAccessControlBiometryCurrentSet,
          &accessError);
      if (access == nullptr) {
        if (accessError != nullptr) CFRelease(accessError);
        Fail("storage-failure");
        return;
      }
      NSMutableData* secret = [NSMutableData dataWithLength:secret_.size()];
      if (!secret_.empty()) memcpy(secret.mutableBytes, secret_.data(), secret_.size());
      query[(__bridge id)kSecAttrAccessControl] = (__bridge id)access;
      query[(__bridge id)kSecValueData] = secret;
      const OSStatus status = SecItemAdd((__bridge CFDictionaryRef)query, nullptr);
      [secret resetBytesInRange:NSMakeRange(0, secret.length)];
      CFRelease(access);
      if (status != errSecSuccess) Fail("storage-failure");
    }
  }

  void OnOK() override {
    SecureClear(secret_);
    deferred_.Resolve(Env().Undefined());
  }

 private:
  std::vector<std::uint8_t> secret_;
};

class ReadWorker final : public PromiseWorker {
 public:
  ReadWorker(Napi::Env env, std::string expectedBundleId, std::string account, std::string reason)
      : PromiseWorker(env, std::move(expectedBundleId), std::move(account)), reason_(std::move(reason)) {}

  ~ReadWorker() override { SecureClear(secret_); }

  void Execute() override {
    @autoreleasepool {
      const AvailabilityResult availability = CheckAvailability(expectedBundleId_);
      if (!availability.available) {
        Fail(availability.reason == "locked-out" ? "locked-out" : "unavailable");
        return;
      }
      LAContext* context = [[LAContext alloc] init];
      context.touchIDAuthenticationAllowableReuseDuration = 0;
      context.localizedReason = String(reason_);
      NSMutableDictionary* query = BaseQuery(account_);
      query[(__bridge id)kSecReturnData] = @YES;
      query[(__bridge id)kSecMatchLimit] = (__bridge id)kSecMatchLimitOne;
      query[(__bridge id)kSecUseAuthenticationContext] = context;

      CFTypeRef result = nullptr;
      const OSStatus status = SecItemCopyMatching((__bridge CFDictionaryRef)query, &result);
      if (status != errSecSuccess) {
        if (result != nullptr) CFRelease(result);
        Fail(ReadErrorCode(status));
        return;
      }
      if (result == nullptr || CFGetTypeID(result) != CFDataGetTypeID()) {
        if (result != nullptr) CFRelease(result);
        Fail("storage-failure");
        return;
      }
      const auto* data = static_cast<CFDataRef>(result);
      const CFIndex length = CFDataGetLength(data);
      const std::uint8_t* bytes = CFDataGetBytePtr(data);
      if (length <= 0 || bytes == nullptr) {
        CFRelease(result);
        Fail("storage-failure");
        return;
      }
      secret_.assign(bytes, bytes + length);
      CFRelease(result);
    }
  }

  void OnOK() override {
    Napi::Buffer<std::uint8_t> output = Napi::Buffer<std::uint8_t>::Copy(Env(), secret_.data(), secret_.size());
    SecureClear(secret_);
    deferred_.Resolve(output);
  }

 private:
  const std::string reason_;
  std::vector<std::uint8_t> secret_;
};

class ClearWorker final : public PromiseWorker {
 public:
  ClearWorker(Napi::Env env, std::string expectedBundleId, std::string account)
      : PromiseWorker(env, std::move(expectedBundleId), std::move(account)) {}

  void Execute() override {
    @autoreleasepool {
      if (!HasTrustedSignature(expectedBundleId_)) {
        Fail("unavailable");
        return;
      }
      const OSStatus status = SecItemDelete((__bridge CFDictionaryRef)BaseQuery(account_));
      if (status != errSecSuccess && status != errSecItemNotFound) Fail("storage-failure");
    }
  }

  void OnOK() override { deferred_.Resolve(Env().Undefined()); }
};

bool ReadString(const Napi::CallbackInfo& info, std::size_t index, const char* label, std::string& output) {
  if (info.Length() <= index || !info[index].IsString()) {
    Napi::TypeError::New(info.Env(), std::string(label) + " must be a string").ThrowAsJavaScriptException();
    return false;
  }
  output = info[index].As<Napi::String>().Utf8Value();
  return !output.empty();
}

Napi::Value Availability(const Napi::CallbackInfo& info) {
  std::string expectedBundleId;
  if (!ReadString(info, 0, "expectedBundleId", expectedBundleId)) return info.Env().Undefined();
  const AvailabilityResult result = CheckAvailability(expectedBundleId);
  Napi::Object value = Napi::Object::New(info.Env());
  value.Set("available", Napi::Boolean::New(info.Env(), result.available));
  value.Set("reason", result.available ? info.Env().Null() : Napi::String::New(info.Env(), result.reason));
  return value;
}

Napi::Value Store(const Napi::CallbackInfo& info) {
  std::string expectedBundleId;
  std::string account;
  if (!ReadString(info, 0, "expectedBundleId", expectedBundleId) || !ReadString(info, 1, "account", account)) {
    return info.Env().Undefined();
  }
  if (info.Length() <= 2 || !info[2].IsBuffer()) {
    Napi::TypeError::New(info.Env(), "secret must be a Buffer").ThrowAsJavaScriptException();
    return info.Env().Undefined();
  }
  const Napi::Buffer<std::uint8_t> secret = info[2].As<Napi::Buffer<std::uint8_t>>();
  if (secret.Length() != 32) {
    Napi::RangeError::New(info.Env(), "secret must contain 32 bytes").ThrowAsJavaScriptException();
    return info.Env().Undefined();
  }
  auto* worker = new StoreWorker(info.Env(), expectedBundleId, account, {secret.Data(), secret.Data() + secret.Length()});
  const Napi::Promise promise = worker->Promise();
  worker->Queue();
  return promise;
}

Napi::Value Read(const Napi::CallbackInfo& info) {
  std::string expectedBundleId;
  std::string account;
  std::string reason;
  if (!ReadString(info, 0, "expectedBundleId", expectedBundleId) || !ReadString(info, 1, "account", account) ||
      !ReadString(info, 2, "reason", reason)) {
    return info.Env().Undefined();
  }
  auto* worker = new ReadWorker(info.Env(), expectedBundleId, account, reason);
  const Napi::Promise promise = worker->Promise();
  worker->Queue();
  return promise;
}

Napi::Value Clear(const Napi::CallbackInfo& info) {
  std::string expectedBundleId;
  std::string account;
  if (!ReadString(info, 0, "expectedBundleId", expectedBundleId) || !ReadString(info, 1, "account", account)) {
    return info.Env().Undefined();
  }
  auto* worker = new ClearWorker(info.Env(), expectedBundleId, account);
  const Napi::Promise promise = worker->Promise();
  worker->Queue();
  return promise;
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("availability", Napi::Function::New(env, Availability));
  exports.Set("store", Napi::Function::New(env, Store));
  exports.Set("read", Napi::Function::New(env, Read));
  exports.Set("clear", Napi::Function::New(env, Clear));
  return exports;
}

}  // namespace

NODE_API_MODULE(overlook_touch_id, Init)
