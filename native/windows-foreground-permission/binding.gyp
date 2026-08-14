{
  "targets": [
    {
      "target_name": "windows_foreground_permission",
      "sources": ["foreground-permission.cc"],
      "defines": ["NAPI_VERSION=8"],
      "libraries": ["user32"]
    }
  ]
}
