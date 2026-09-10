import Foundation
import Capacitor
import Speech
import AVFoundation

/* Native dictation for Sage: WKWebView has no Web Speech API, so the web
   layer calls this tiny bridge instead. Emits "partial" events with the
   transcript as it firms up, and "end" when listening stops. */
@objc(SpeechPlugin)
public class SpeechPlugin: CAPPlugin {
    private let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
    private var audioEngine: AVAudioEngine?
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?

    @objc func available(_ call: CAPPluginCall) {
        call.resolve(["available": recognizer?.isAvailable ?? false])
    }

    @objc func requestPermission(_ call: CAPPluginCall) {
        SFSpeechRecognizer.requestAuthorization { auth in
            AVAudioSession.sharedInstance().requestRecordPermission { mic in
                call.resolve(["granted": auth == .authorized && mic])
            }
        }
    }

    @objc func start(_ call: CAPPluginCall) {
#if targetEnvironment(simulator)
        // AVAudioEngine's input node aborts with an AudioToolbox RPC timeout in
        // the Simulator (uncatchable SIGABRT). Real devices are unaffected.
        call.reject("Voice input isn't available in the Simulator."); return
#else
        stopInternal()
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.record, mode: .measurement, options: .duckOthers)
            try session.setActive(true, options: .notifyOthersOnDeactivation)
        } catch {
            call.reject("Audio session unavailable: \(error.localizedDescription)"); return
        }
        let engine = AVAudioEngine()
        let req = SFSpeechAudioBufferRecognitionRequest()
        req.shouldReportPartialResults = true
        let node = engine.inputNode
        let fmt = node.outputFormat(forBus: 0)
        node.installTap(onBus: 0, bufferSize: 1024, format: fmt) { buf, _ in req.append(buf) }
        engine.prepare()
        do { try engine.start() } catch {
            call.reject("Microphone unavailable: \(error.localizedDescription)"); return
        }
        audioEngine = engine
        request = req
        task = recognizer?.recognitionTask(with: req) { [weak self] result, error in
            if let r = result {
                self?.notifyListeners("partial", data: [
                    "text": r.bestTranscription.formattedString, "final": r.isFinal])
                if r.isFinal { self?.finish() }
            }
            if error != nil { self?.finish() }
        }
        call.resolve()
#endif
    }

    @objc func stop(_ call: CAPPluginCall) {
        request?.endAudio()
        finish()
        call.resolve()
    }

    private func finish() {
        stopInternal()
        notifyListeners("end", data: [:])
    }

    private func stopInternal() {
        audioEngine?.stop()
        audioEngine?.inputNode.removeTap(onBus: 0)
        audioEngine = nil
        task?.cancel(); task = nil; request = nil
    }
}
