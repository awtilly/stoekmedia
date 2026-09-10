import UIKit
import Capacitor

/* Capacitor 6+ only auto-registers plugins listed in the generated
   packageClassList (npm plugins). Local plugins such as SpeechPlugin have to
   be registered by hand once the bridge exists — SceneDelegate uses this
   subclass as the root view controller for that reason. registerPluginType
   is a no-op while auto-registration is on, so register an instance. */
class GDBridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(SpeechPlugin())
    }
}
