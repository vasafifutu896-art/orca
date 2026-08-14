#include <node_api.h>
#include <windows.h>

#include <cmath>
#include <cstdint>

namespace {

napi_value CreateResult(napi_env env, bool granted, UINT inputs_sent,
                        DWORD error_code) {
  napi_value result;
  napi_value granted_value;
  napi_value inputs_sent_value;
  napi_value error_code_value;
  napi_create_object(env, &result);
  napi_get_boolean(env, granted, &granted_value);
  napi_create_uint32(env, inputs_sent, &inputs_sent_value);
  napi_create_uint32(env, error_code, &error_code_value);
  napi_set_named_property(env, result, "granted", granted_value);
  napi_set_named_property(env, result, "inputsSent", inputs_sent_value);
  napi_set_named_property(env, result, "errorCode", error_code_value);
  return result;
}

napi_value GrantWindowsForegroundPermission(napi_env env,
                                            napi_callback_info info) {
  size_t argument_count = 2;
  napi_value arguments[2];
  const napi_status argument_status =
      napi_get_cb_info(env, info, &argument_count, arguments, nullptr, nullptr);

  double raw_pid = 0;
  if (argument_status != napi_ok || argument_count != 1 ||
      napi_get_value_double(env, arguments[0], &raw_pid) != napi_ok ||
      !std::isfinite(raw_pid) || std::floor(raw_pid) != raw_pid ||
      raw_pid <= 0 || raw_pid >= static_cast<double>(ASFW_ANY)) {
    return CreateResult(env, false, 0, ERROR_INVALID_PARAMETER);
  }

  // Mirrors Chromium's zero-key toast handoff without changing a real key:
  // https://chromium.googlesource.com/chromium/src/+/master/chrome/notification_helper/notification_activator.cc
  INPUT inputs[2] = {};
  inputs[0].type = INPUT_KEYBOARD;
  inputs[1] = inputs[0];
  inputs[1].ki.dwFlags = KEYEVENTF_KEYUP;

  SetLastError(ERROR_SUCCESS);
  const UINT inputs_sent = ::SendInput(2, inputs, sizeof(INPUT));
  const DWORD input_error = inputs_sent == 2 ? ERROR_SUCCESS : GetLastError();

  SetLastError(ERROR_SUCCESS);
  const BOOL allowed = ::AllowSetForegroundWindow(static_cast<DWORD>(raw_pid));
  const DWORD grant_error = allowed ? ERROR_SUCCESS : GetLastError();
  return CreateResult(env, allowed != FALSE, inputs_sent,
                      allowed ? input_error : grant_error);
}

napi_value Initialize(napi_env env, napi_value exports) {
  napi_value grant;
  napi_create_function(env, "grantWindowsForegroundPermission",
                       NAPI_AUTO_LENGTH, GrantWindowsForegroundPermission,
                       nullptr, &grant);
  napi_set_named_property(env, exports, "grantWindowsForegroundPermission",
                          grant);
  return exports;
}

} // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, Initialize)
