#import <Foundation/Foundation.h>
@import Capacitor;

CAP_PLUGIN(SpeechPlugin, "Speech",
  CAP_PLUGIN_METHOD(available, CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(requestPermission, CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(start, CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(stop, CAPPluginReturnPromise);
)
