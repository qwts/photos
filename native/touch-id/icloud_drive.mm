#import <Foundation/Foundation.h>
#import <Security/SecCode.h>
#import <Security/Security.h>

#include <napi.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstddef>
#include <iomanip>
#include <memory>
#include <sstream>
#include <string>
#include <thread>
#include <utility>
#include <vector>

namespace {

constexpr const char* kExpectedTeamIdentifier = "Z5DM34QS5U";
constexpr const char* kExpectedApplicationIdentifier = "Z5DM34QS5U.com.zts1.overlook";
constexpr std::size_t kMaximumPathLength = 4096;
constexpr int kMaterializationAttempts = 300;

NSString* String(const std::string& value) {
  return [[NSString alloc] initWithBytes:value.data() length:value.size() encoding:NSUTF8StringEncoding];
}

std::string Utf8(NSString* value) {
  if (value == nil) return "";
  const char* bytes = value.UTF8String;
  return bytes == nullptr ? "" : bytes;
}

bool ArrayContains(CFDictionaryRef entitlements, CFStringRef key, NSString* expected) {
  const auto* value = static_cast<CFArrayRef>(CFDictionaryGetValue(entitlements, key));
  if (value == nullptr || CFGetTypeID(value) != CFArrayGetTypeID()) return false;
  for (CFIndex index = 0; index < CFArrayGetCount(value); ++index) {
    const auto* item = static_cast<CFTypeRef>(CFArrayGetValueAtIndex(value, index));
    if (item != nullptr && CFGetTypeID(item) == CFStringGetTypeID() &&
        CFStringCompare(static_cast<CFStringRef>(item), (__bridge CFStringRef)expected, 0) == kCFCompareEqualTo) {
      return true;
    }
  }
  return false;
}

enum class SignatureState { kTrusted, kUnsigned, kUnentitled };

SignatureState Signature(const std::string& expectedBundleId, const std::string& containerId) {
  @autoreleasepool {
    NSString* expectedBundle = String(expectedBundleId);
    NSString* expectedContainer = String(containerId);
    NSString* bundleId = NSBundle.mainBundle.bundleIdentifier;
    if (expectedBundle == nil || expectedContainer == nil || bundleId == nil ||
        ![bundleId isEqualToString:expectedBundle]) {
      return SignatureState::kUnsigned;
    }

    SecCodeRef code = nullptr;
    if (SecCodeCopySelf(kSecCSDefaultFlags, &code) != errSecSuccess || code == nullptr) return SignatureState::kUnsigned;
    const OSStatus validity = SecCodeCheckValidity(code, kSecCSStrictValidate, nullptr);
    if (validity != errSecSuccess) {
      CFRelease(code);
      return SignatureState::kUnsigned;
    }

    CFDictionaryRef information = nullptr;
    const OSStatus copied = SecCodeCopySigningInformation(code, kSecCSSigningInformation, &information);
    CFRelease(code);
    if (copied != errSecSuccess || information == nullptr) return SignatureState::kUnsigned;

    const auto* identifier = static_cast<CFStringRef>(CFDictionaryGetValue(information, kSecCodeInfoIdentifier));
    const auto* teamIdentifier = static_cast<CFStringRef>(CFDictionaryGetValue(information, kSecCodeInfoTeamIdentifier));
    const auto* entitlements = static_cast<CFDictionaryRef>(CFDictionaryGetValue(information, kSecCodeInfoEntitlementsDict));
    const auto* flagsValue = static_cast<CFNumberRef>(CFDictionaryGetValue(information, kSecCodeInfoFlags));
    if (identifier == nullptr || teamIdentifier == nullptr || entitlements == nullptr || flagsValue == nullptr ||
        CFGetTypeID(identifier) != CFStringGetTypeID() || CFGetTypeID(teamIdentifier) != CFStringGetTypeID() ||
        CFGetTypeID(entitlements) != CFDictionaryGetTypeID() || CFGetTypeID(flagsValue) != CFNumberGetTypeID()) {
      CFRelease(information);
      return SignatureState::kUnsigned;
    }

    std::uint32_t flags = 0;
    CFNumberGetValue(flagsValue, kCFNumberSInt32Type, &flags);
    NSString* expectedTeam = String(kExpectedTeamIdentifier);
    NSString* expectedApplication = String(kExpectedApplicationIdentifier);
    const auto* applicationIdentifier = static_cast<CFStringRef>(
        CFDictionaryGetValue(entitlements, CFSTR("com.apple.application-identifier")));
    const auto* entitlementTeam = static_cast<CFStringRef>(
        CFDictionaryGetValue(entitlements, CFSTR("com.apple.developer.team-identifier")));
    const bool identityTrusted = expectedTeam != nil && expectedApplication != nil && applicationIdentifier != nullptr &&
                                 entitlementTeam != nullptr &&
                                 CFGetTypeID(applicationIdentifier) == CFStringGetTypeID() &&
                                 CFGetTypeID(entitlementTeam) == CFStringGetTypeID() &&
                                 CFStringCompare(identifier, (__bridge CFStringRef)expectedBundle, 0) == kCFCompareEqualTo &&
                                 CFStringCompare(teamIdentifier, (__bridge CFStringRef)expectedTeam, 0) == kCFCompareEqualTo &&
                                 CFStringCompare(applicationIdentifier, (__bridge CFStringRef)expectedApplication, 0) ==
                                     kCFCompareEqualTo &&
                                 CFStringCompare(entitlementTeam, (__bridge CFStringRef)expectedTeam, 0) == kCFCompareEqualTo &&
                                 (flags & kSecCodeSignatureAdhoc) == 0;
    if (!identityTrusted) {
      CFRelease(information);
      return SignatureState::kUnsigned;
    }

    const bool iCloudTrusted =
        ArrayContains(entitlements, CFSTR("com.apple.developer.ubiquity-container-identifiers"),
                      expectedContainer) &&
        ArrayContains(entitlements, CFSTR("com.apple.developer.icloud-container-identifiers"), expectedContainer) &&
        ArrayContains(entitlements, CFSTR("com.apple.developer.icloud-services"), @"CloudDocuments");
    CFRelease(information);
    return iCloudTrusted ? SignatureState::kTrusted : SignatureState::kUnentitled;
  }
}

std::string AccountToken(id token) {
  if (token == nil) return "";
  std::ostringstream output;
  output << std::hex << std::setfill('0') << std::setw(16) << static_cast<unsigned long long>([token hash]);
  return output.str();
}

bool SafeRelativePath(const std::string& path) {
  if (path.empty() || path.size() > 1024 || path.front() == '/') return false;
  std::size_t start = 0;
  while (start <= path.size()) {
    const std::size_t end = path.find('/', start);
    const std::string part = path.substr(start, end == std::string::npos ? std::string::npos : end - start);
    if (part.empty() || part == "." || part == "..") return false;
    for (const char value : part) {
      const bool valid = (value >= 'a' && value <= 'z') || (value >= 'A' && value <= 'Z') ||
                         (value >= '0' && value <= '9') || value == '.' || value == '_' || value == '-';
      if (!valid) return false;
    }
    if (end == std::string::npos) break;
    start = end + 1;
  }
  return true;
}

std::string ErrorCode(NSError* error, const std::string& fallback = "io-failure") {
  if (error == nil) return fallback;
  if ([error.domain isEqualToString:NSURLErrorDomain] &&
      (error.code == NSURLErrorNotConnectedToInternet || error.code == NSURLErrorNetworkConnectionLost ||
       error.code == NSURLErrorTimedOut)) {
    return "offline";
  }
  if ([error.domain isEqualToString:NSCocoaErrorDomain] &&
      (error.code == NSFileNoSuchFileError || error.code == NSFileReadNoSuchFileError)) {
    return "not-found";
  }
  return fallback;
}

bool HasConflict(NSURL* url) {
  return [NSFileVersion unresolvedConflictVersionsOfItemAtURL:url].count > 0;
}

struct Context {
  NSURL* documents;
  std::string accountToken;
  std::string error;
};

Context Resolve(const std::string& expectedBundleId, const std::string& containerId) {
  @autoreleasepool {
    const SignatureState signature = Signature(expectedBundleId, containerId);
    if (signature == SignatureState::kUnsigned) return {nil, "", "unavailable"};
    if (signature == SignatureState::kUnentitled) return {nil, "", "unentitled"};
    NSFileManager* files = NSFileManager.defaultManager;
    const std::string token = AccountToken(files.ubiquityIdentityToken);
    if (token.empty()) return {nil, "", "account-unavailable"};
    NSURL* container = [files URLForUbiquityContainerIdentifier:String(containerId)];
    if (container == nil) return {nil, "", "account-unavailable"};
    return {[container URLByAppendingPathComponent:@"Documents" isDirectory:YES], token, ""};
  }
}

NSURL* ItemUrl(NSURL* documents, const std::string& path) {
  return [documents URLByAppendingPathComponent:String(path) isDirectory:NO];
}

bool SameAccount(const Context& context, const std::string& expected) {
  return !expected.empty() && context.accountToken == expected &&
         AccountToken(NSFileManager.defaultManager.ubiquityIdentityToken) == expected;
}

using EnvironmentAlive = std::shared_ptr<std::atomic_bool>;

class TeardownSafeWorker : public Napi::AsyncWorker {
 public:
  TeardownSafeWorker(Napi::Env env, EnvironmentAlive environmentAlive)
      : Napi::AsyncWorker(env), environmentAlive_(std::move(environmentAlive)) {}

  void OnWorkComplete(Napi::Env env, napi_status status) override {
    // node-addon-api's base completion creates a HandleScope and, on error,
    // constructs a JS Error before dispatching OnError. Once the environment
    // cleanup hook fires none of that is safe. Intentionally leave this
    // process-exit worker for the OS instead of invoking more N-API teardown.
    if (!environmentAlive_->load(std::memory_order_acquire)) return;
    Napi::AsyncWorker::OnWorkComplete(env, status);
  }

 private:
  const EnvironmentAlive environmentAlive_;
};

class ICloudWorker : public TeardownSafeWorker {
 public:
  ICloudWorker(Napi::Env env, EnvironmentAlive environmentAlive, std::string expectedBundleId,
               std::string containerId, std::string accountToken)
      : TeardownSafeWorker(env, std::move(environmentAlive)), deferred_(Napi::Promise::Deferred::New(env)),
        expectedBundleId_(std::move(expectedBundleId)), containerId_(std::move(containerId)),
        expectedAccountToken_(std::move(accountToken)) {}

  Napi::Promise Promise() const { return deferred_.Promise(); }

 protected:
  bool Prepare(Context& context) {
    context = Resolve(expectedBundleId_, containerId_);
    if (!context.error.empty()) {
      Fail(context.error);
      return false;
    }
    if (!SameAccount(context, expectedAccountToken_)) {
      Fail("account-changed");
      return false;
    }
    return true;
  }

  void Fail(std::string code) {
    errorCode_ = std::move(code);
    SetError("iCloud Drive native operation failed");
  }

  void OnError(const Napi::Error& error) override {
    Napi::Object value = error.Value();
    value.Set("code", Napi::String::New(Env(), errorCode_.empty() ? "unavailable" : errorCode_));
    deferred_.Reject(value);
  }

  Napi::Promise::Deferred deferred_;

 private:
  const std::string expectedBundleId_;
  const std::string containerId_;
  const std::string expectedAccountToken_;
  std::string errorCode_;
};

class StatusWorker final : public TeardownSafeWorker {
 public:
  StatusWorker(Napi::Env env, EnvironmentAlive environmentAlive, std::string expectedBundleId,
               std::string containerId)
      : TeardownSafeWorker(env, std::move(environmentAlive)), deferred_(Napi::Promise::Deferred::New(env)),
        expectedBundleId_(std::move(expectedBundleId)), containerId_(std::move(containerId)) {}

  Napi::Promise Promise() const { return deferred_.Promise(); }

  void Execute() override {
    @autoreleasepool {
      const SignatureState signature = Signature(expectedBundleId_, containerId_);
      if (signature == SignatureState::kUnsigned) {
        reason_ = "unsigned-build";
        return;
      }
      if (signature == SignatureState::kUnentitled) {
        reason_ = "unentitled";
        return;
      }
      NSFileManager* files = NSFileManager.defaultManager;
      accountToken_ = AccountToken(files.ubiquityIdentityToken);
      if (accountToken_.empty() || [files URLForUbiquityContainerIdentifier:String(containerId_)] == nil) {
        accountToken_.clear();
        reason_ = "account-unavailable";
      }
    }
  }

  void OnOK() override {
    Napi::Object result = Napi::Object::New(Env());
    const bool available = reason_.empty();
    result.Set("available", Napi::Boolean::New(Env(), available));
    result.Set("reason", available ? Env().Null() : Napi::String::New(Env(), reason_));
    result.Set("accountToken", available ? Napi::String::New(Env(), accountToken_) : Env().Null());
    deferred_.Resolve(result);
  }

 private:
  Napi::Promise::Deferred deferred_;
  const std::string expectedBundleId_;
  const std::string containerId_;
  std::string reason_;
  std::string accountToken_;
};

bool AtomicCopy(NSFileManager* files, NSURL* source, NSURL* destination, NSError** error) {
  NSURL* parent = [destination URLByDeletingLastPathComponent];
  if (![files createDirectoryAtURL:parent withIntermediateDirectories:YES attributes:nil error:error]) return false;
  NSURL* temporary = [parent URLByAppendingPathComponent:[NSString stringWithFormat:@".overlook-%@.tmp", NSUUID.UUID.UUIDString]];
  if (![files copyItemAtURL:source toURL:temporary error:error]) return false;
  bool succeeded = false;
  if ([files fileExistsAtPath:destination.path]) {
    succeeded = [files replaceItemAtURL:destination
                          withItemAtURL:temporary
                         backupItemName:nil
                                options:0
                       resultingItemURL:nil
                                  error:error];
  } else {
    succeeded = [files moveItemAtURL:temporary toURL:destination error:error];
  }
  if (!succeeded) [files removeItemAtURL:temporary error:nil];
  return succeeded;
}

class ReplaceWorker final : public ICloudWorker {
 public:
  ReplaceWorker(Napi::Env env, EnvironmentAlive environmentAlive, std::string bundleId, std::string containerId,
                std::string path, std::string source, std::string accountToken)
      : ICloudWorker(env, std::move(environmentAlive), std::move(bundleId), std::move(containerId),
                     std::move(accountToken)),
        path_(std::move(path)),
        source_(std::move(source)) {}

  void Execute() override {
    @autoreleasepool {
      Context context;
      if (!Prepare(context)) return;
      NSURL* source = [NSURL fileURLWithPath:String(source_)];
      NSURL* destination = ItemUrl(context.documents, path_);
      NSFileCoordinator* coordinator = [[NSFileCoordinator alloc] initWithFilePresenter:nil];
      __block NSError* operationError = nil;
      NSError* coordinationError = nil;
      [coordinator coordinateReadingItemAtURL:source
                                      options:0
                             writingItemAtURL:destination
                                      options:NSFileCoordinatorWritingForReplacing
                                        error:&coordinationError
                                   byAccessor:^(NSURL* coordinatedSource, NSURL* coordinatedDestination) {
                                     AtomicCopy(NSFileManager.defaultManager, coordinatedSource, coordinatedDestination,
                                                &operationError);
                                   }];
      NSError* error = coordinationError ?: operationError;
      if (error != nil) {
        Fail(ErrorCode(error));
        return;
      }
      if (!SameAccount(context, context.accountToken)) {
        Fail("account-changed");
        return;
      }
      if (HasConflict(destination)) Fail("conflict");
    }
  }

  void OnOK() override { deferred_.Resolve(Env().Undefined()); }

 private:
  const std::string path_;
  const std::string source_;
};

bool Downloaded(NSURL* url, NSError** error) {
  NSNumber* ubiquitous = nil;
  if (![url getResourceValue:&ubiquitous forKey:NSURLIsUbiquitousItemKey error:error]) return false;
  if (!ubiquitous.boolValue) return true;
  NSString* status = nil;
  if (![url getResourceValue:&status forKey:NSURLUbiquitousItemDownloadingStatusKey error:error]) return false;
  return [status isEqualToString:NSURLUbiquitousItemDownloadingStatusCurrent];
}

class MaterializeWorker final : public ICloudWorker {
 public:
  MaterializeWorker(Napi::Env env, EnvironmentAlive environmentAlive, std::string bundleId,
                    std::string containerId, std::string path, std::string destination, std::string accountToken)
      : ICloudWorker(env, std::move(environmentAlive), std::move(bundleId), std::move(containerId),
                     std::move(accountToken)),
        path_(std::move(path)),
        destination_(std::move(destination)) {}

  void Execute() override {
    @autoreleasepool {
      Context context;
      if (!Prepare(context)) return;
      NSURL* source = ItemUrl(context.documents, path_);
      NSFileManager* files = NSFileManager.defaultManager;
      if (![files fileExistsAtPath:source.path]) {
        Fail("not-found");
        return;
      }
      NSError* error = nil;
      if (![files startDownloadingUbiquitousItemAtURL:source error:&error] && error != nil) {
        Fail(ErrorCode(error));
        return;
      }
      bool downloaded = false;
      for (int attempt = 0; attempt < kMaterializationAttempts; ++attempt) {
        error = nil;
        if (Downloaded(source, &error)) {
          downloaded = true;
          break;
        }
        if (error != nil) {
          Fail(ErrorCode(error));
          return;
        }
        if (!SameAccount(context, context.accountToken)) {
          Fail("account-changed");
          return;
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
      }
      if (!downloaded) {
        Fail("materialization-delayed");
        return;
      }
      if (HasConflict(source)) {
        Fail("conflict");
        return;
      }
      NSURL* destination = [NSURL fileURLWithPath:String(destination_)];
      NSFileCoordinator* coordinator = [[NSFileCoordinator alloc] initWithFilePresenter:nil];
      __block NSError* operationError = nil;
      NSError* coordinationError = nil;
      [coordinator coordinateReadingItemAtURL:source
                                      options:0
                                        error:&coordinationError
                                   byAccessor:^(NSURL* coordinatedSource) {
                                     AtomicCopy(files, coordinatedSource, destination, &operationError);
                                   }];
      error = coordinationError ?: operationError;
      if (error != nil) Fail(ErrorCode(error));
    }
  }

  void OnOK() override { deferred_.Resolve(Env().Undefined()); }

 private:
  const std::string path_;
  const std::string destination_;
};

struct Entry {
  std::string path;
  std::uint64_t size;
  std::string modifiedAt;
  bool downloaded;
  bool conflicted;
};

NSString* IsoDate(NSDate* date) {
  NSISO8601DateFormatter* formatter = [[NSISO8601DateFormatter alloc] init];
  formatter.formatOptions = NSISO8601DateFormatWithInternetDateTime | NSISO8601DateFormatWithFractionalSeconds;
  return [formatter stringFromDate:date ?: [NSDate dateWithTimeIntervalSince1970:0]];
}

class ListWorker final : public ICloudWorker {
 public:
  ListWorker(Napi::Env env, EnvironmentAlive environmentAlive, std::string bundleId, std::string containerId,
             std::string path, std::size_t offset, std::size_t limit, std::string accountToken)
      : ICloudWorker(env, std::move(environmentAlive), std::move(bundleId), std::move(containerId),
                     std::move(accountToken)),
        path_(std::move(path)),
        offset_(offset), limit_(limit) {}

  void Execute() override {
    @autoreleasepool {
      Context context;
      if (!Prepare(context)) return;
      accountToken_ = context.accountToken;
      NSURL* root = ItemUrl(context.documents, path_);
      NSFileManager* files = NSFileManager.defaultManager;
      if (![files fileExistsAtPath:root.path]) return;
      NSArray<NSURLResourceKey>* keys = @[
        NSURLIsRegularFileKey, NSURLFileSizeKey, NSURLContentModificationDateKey, NSURLIsUbiquitousItemKey,
        NSURLUbiquitousItemDownloadingStatusKey
      ];
      __block NSError* enumerationError = nil;
      NSDirectoryEnumerator<NSURL*>* enumerator =
          [files enumeratorAtURL:root
      includingPropertiesForKeys:keys
                         options:NSDirectoryEnumerationSkipsHiddenFiles
                    errorHandler:^BOOL(NSURL*, NSError* error) {
                      enumerationError = error;
                      return NO;
                    }];
      for (NSURL* url in enumerator) {
        NSError* error = nil;
        NSDictionary<NSURLResourceKey, id>* values = [url resourceValuesForKeys:keys error:&error];
        if (error != nil) {
          Fail(ErrorCode(error));
          return;
        }
        if (![values[NSURLIsRegularFileKey] boolValue]) continue;
        std::string relative = Utf8(url.path);
        const std::string documents = Utf8(context.documents.path);
        if (relative.rfind(documents + "/", 0) != 0) {
          Fail("invalid-path");
          return;
        }
        relative = relative.substr(documents.size() + 1);
        const bool ubiquitous = [values[NSURLIsUbiquitousItemKey] boolValue];
        const bool downloaded = !ubiquitous ||
                                [values[NSURLUbiquitousItemDownloadingStatusKey]
                                    isEqualToString:NSURLUbiquitousItemDownloadingStatusCurrent];
        entries_.push_back({relative, [values[NSURLFileSizeKey] unsignedLongLongValue],
                            Utf8(IsoDate(values[NSURLContentModificationDateKey])), downloaded, HasConflict(url)});
      }
      if (enumerationError != nil) {
        Fail(ErrorCode(enumerationError));
        return;
      }
      if (!SameAccount(context, context.accountToken)) {
        Fail("account-changed");
        return;
      }
      std::sort(entries_.begin(), entries_.end(), [](const Entry& left, const Entry& right) { return left.path < right.path; });
      if (offset_ >= entries_.size()) {
        entries_.clear();
        return;
      }
      const std::size_t end = std::min(entries_.size(), offset_ + limit_);
      nextOffset_ = end < entries_.size() ? end : 0;
      entries_ = std::vector<Entry>(entries_.begin() + static_cast<std::ptrdiff_t>(offset_),
                                    entries_.begin() + static_cast<std::ptrdiff_t>(end));
    }
  }

  void OnOK() override {
    Napi::Object result = Napi::Object::New(Env());
    Napi::Array entries = Napi::Array::New(Env(), entries_.size());
    for (std::size_t index = 0; index < entries_.size(); ++index) {
      const Entry& source = entries_[index];
      Napi::Object entry = Napi::Object::New(Env());
      entry.Set("path", source.path);
      entry.Set("size", Napi::Number::New(Env(), static_cast<double>(source.size)));
      entry.Set("modifiedAt", source.modifiedAt);
      entry.Set("downloaded", source.downloaded);
      entry.Set("conflicted", source.conflicted);
      entries.Set(index, entry);
    }
    result.Set("entries", entries);
    result.Set("nextCursor", nextOffset_ == 0 ? Env().Null() : Napi::String::New(Env(), std::to_string(nextOffset_)));
    result.Set("accountToken", accountToken_);
    deferred_.Resolve(result);
  }

 private:
  const std::string path_;
  const std::size_t offset_;
  const std::size_t limit_;
  std::vector<Entry> entries_;
  std::size_t nextOffset_ = 0;
  std::string accountToken_;
};

class DeleteWorker final : public ICloudWorker {
 public:
  DeleteWorker(Napi::Env env, EnvironmentAlive environmentAlive, std::string bundleId, std::string containerId,
               std::string path, std::string accountToken)
      : ICloudWorker(env, std::move(environmentAlive), std::move(bundleId), std::move(containerId),
                     std::move(accountToken)),
        path_(std::move(path)) {}

  void Execute() override {
    @autoreleasepool {
      Context context;
      if (!Prepare(context)) return;
      NSURL* target = ItemUrl(context.documents, path_);
      if (![NSFileManager.defaultManager fileExistsAtPath:target.path]) return;
      NSFileCoordinator* coordinator = [[NSFileCoordinator alloc] initWithFilePresenter:nil];
      __block NSError* operationError = nil;
      NSError* coordinationError = nil;
      [coordinator coordinateWritingItemAtURL:target
                                      options:NSFileCoordinatorWritingForDeleting
                                        error:&coordinationError
                                   byAccessor:^(NSURL* coordinatedTarget) {
                                     [NSFileManager.defaultManager removeItemAtURL:coordinatedTarget error:&operationError];
                                   }];
      NSError* error = coordinationError ?: operationError;
      if (error != nil) Fail(ErrorCode(error));
    }
  }

  void OnOK() override { deferred_.Resolve(Env().Undefined()); }

 private:
  const std::string path_;
};

bool ReadString(const Napi::CallbackInfo& info, std::size_t index, const char* label, std::string& output) {
  if (info.Length() <= index || !info[index].IsString()) {
    Napi::TypeError::New(info.Env(), std::string(label) + " must be a string").ThrowAsJavaScriptException();
    return false;
  }
  output = info[index].As<Napi::String>().Utf8Value();
  if (output.empty() || output.size() > kMaximumPathLength) {
    Napi::RangeError::New(info.Env(), std::string(label) + " is invalid").ThrowAsJavaScriptException();
    return false;
  }
  return true;
}

bool ReadOperation(const Napi::CallbackInfo& info, std::string& bundleId, std::string& containerId, std::string& path) {
  if (!ReadString(info, 0, "bundleId", bundleId) || !ReadString(info, 1, "containerId", containerId) ||
      !ReadString(info, 2, "path", path)) {
    return false;
  }
  if (!SafeRelativePath(path)) {
    Napi::RangeError::New(info.Env(), "path is invalid").ThrowAsJavaScriptException();
    return false;
  }
  return true;
}

EnvironmentAlive EnvironmentState(const Napi::CallbackInfo& info) {
  return *static_cast<EnvironmentAlive*>(info.Data());
}

Napi::Value Status(const Napi::CallbackInfo& info) {
  std::string bundleId;
  std::string containerId;
  if (!ReadString(info, 0, "bundleId", bundleId) || !ReadString(info, 1, "containerId", containerId)) {
    return info.Env().Undefined();
  }
  auto* worker = new StatusWorker(info.Env(), EnvironmentState(info), std::move(bundleId), std::move(containerId));
  const Napi::Promise promise = worker->Promise();
  worker->Queue();
  return promise;
}

Napi::Value ReplaceFile(const Napi::CallbackInfo& info) {
  std::string bundleId, containerId, path, source, accountToken;
  if (!ReadOperation(info, bundleId, containerId, path) || !ReadString(info, 3, "sourceFile", source) ||
      !ReadString(info, 4, "accountToken", accountToken)) {
    return info.Env().Undefined();
  }
  if (![String(source) isAbsolutePath]) {
    Napi::RangeError::New(info.Env(), "sourceFile is invalid").ThrowAsJavaScriptException();
    return info.Env().Undefined();
  }
  auto* worker = new ReplaceWorker(info.Env(), EnvironmentState(info), std::move(bundleId),
                                   std::move(containerId), std::move(path), std::move(source),
                                   std::move(accountToken));
  const Napi::Promise promise = worker->Promise();
  worker->Queue();
  return promise;
}

Napi::Value MaterializeFile(const Napi::CallbackInfo& info) {
  std::string bundleId, containerId, path, destination, accountToken;
  if (!ReadOperation(info, bundleId, containerId, path) || !ReadString(info, 3, "destinationFile", destination) ||
      !ReadString(info, 4, "accountToken", accountToken)) {
    return info.Env().Undefined();
  }
  if (![String(destination) isAbsolutePath]) {
    Napi::RangeError::New(info.Env(), "destinationFile is invalid").ThrowAsJavaScriptException();
    return info.Env().Undefined();
  }
  auto* worker = new MaterializeWorker(info.Env(), EnvironmentState(info), std::move(bundleId),
                                       std::move(containerId), std::move(path), std::move(destination),
                                       std::move(accountToken));
  const Napi::Promise promise = worker->Promise();
  worker->Queue();
  return promise;
}

Napi::Value List(const Napi::CallbackInfo& info) {
  std::string bundleId, containerId, path, accountToken;
  if (!ReadOperation(info, bundleId, containerId, path) || info.Length() <= 3 ||
      !(info[3].IsNull() || info[3].IsString()) || info.Length() <= 4 || !info[4].IsNumber() ||
      !ReadString(info, 5, "accountToken", accountToken)) {
    return info.Env().Undefined();
  }
  std::size_t offset = 0;
  if (info[3].IsString()) {
    const std::string cursor = info[3].As<Napi::String>().Utf8Value();
    if (cursor.empty()) {
      Napi::RangeError::New(info.Env(), "cursor is invalid").ThrowAsJavaScriptException();
      return info.Env().Undefined();
    }
    for (const char digit : cursor) {
      if (digit < '0' || digit > '9' || offset > (SIZE_MAX - static_cast<std::size_t>(digit - '0')) / 10) {
        Napi::RangeError::New(info.Env(), "cursor is invalid").ThrowAsJavaScriptException();
        return info.Env().Undefined();
      }
      offset = offset * 10 + static_cast<std::size_t>(digit - '0');
    }
  }
  const double rawLimit = info[4].As<Napi::Number>().DoubleValue();
  if (rawLimit < 1 || rawLimit > 1000 || rawLimit != static_cast<std::size_t>(rawLimit)) {
    Napi::RangeError::New(info.Env(), "limit is invalid").ThrowAsJavaScriptException();
    return info.Env().Undefined();
  }
  auto* worker = new ListWorker(info.Env(), EnvironmentState(info), std::move(bundleId),
                                std::move(containerId), std::move(path), offset,
                                static_cast<std::size_t>(rawLimit), std::move(accountToken));
  const Napi::Promise promise = worker->Promise();
  worker->Queue();
  return promise;
}

Napi::Value Delete(const Napi::CallbackInfo& info) {
  std::string bundleId, containerId, path, accountToken;
  if (!ReadOperation(info, bundleId, containerId, path) || !ReadString(info, 3, "accountToken", accountToken)) {
    return info.Env().Undefined();
  }
  auto* worker = new DeleteWorker(info.Env(), EnvironmentState(info), std::move(bundleId),
                                  std::move(containerId), std::move(path), std::move(accountToken));
  const Napi::Promise promise = worker->Promise();
  worker->Queue();
  return promise;
}

void MarkEnvironmentDead(void* data) {
  auto* environmentAlive = static_cast<EnvironmentAlive*>(data);
  (*environmentAlive)->store(false, std::memory_order_release);
  delete environmentAlive;
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  auto* environmentAlive = new EnvironmentAlive(std::make_shared<std::atomic_bool>(true));
  if (napi_add_env_cleanup_hook(env, MarkEnvironmentDead, environmentAlive) != napi_ok) {
    delete environmentAlive;
    Napi::Error::New(env, "could not register iCloud environment cleanup").ThrowAsJavaScriptException();
    return exports;
  }
  exports.Set("status", Napi::Function::New(env, Status, "status", environmentAlive));
  exports.Set("replaceFile", Napi::Function::New(env, ReplaceFile, "replaceFile", environmentAlive));
  exports.Set("materializeFile",
              Napi::Function::New(env, MaterializeFile, "materializeFile", environmentAlive));
  exports.Set("list", Napi::Function::New(env, List, "list", environmentAlive));
  exports.Set("delete", Napi::Function::New(env, Delete, "delete", environmentAlive));
  return exports;
}

}  // namespace

NODE_API_MODULE(overlook_icloud_drive, Init)
