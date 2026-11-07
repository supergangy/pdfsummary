import ExpoModulesCore
import Foundation
#if canImport(FoundationModels)
import FoundationModels
#endif

// 아이패드·아이폰의 Apple 기기 안 AI(Foundation Models, iOS 26+)로 짧은 글을 쓴다.
// 인터넷·API 키 없이 기기 안에서만 돈다. Apple Intelligence를 켠 지원 기기에서만 쓸 수 있다.
public class DeviceAiModule: Module {
  public func definition() -> ModuleDefinition {
    Name("DeviceAi")

    // 상태: JSON 글 {"status": available|not-ready|unavailable, "reason": …, "engine": "apple"}
    AsyncFunction("getStatusAsync") { () -> String in
      return DeviceAiModule.status()
    }

    // 애플은 모델을 시스템이 알아서 받으므로 따로 받을 것이 없다
    AsyncFunction("prepareAsync") { () -> String in
      return DeviceAiModule.status()
    }

    AsyncFunction("generateAsync") { (instructions: String, prompt: String, maxTokens: Int) async throws -> String in
      #if canImport(FoundationModels)
      if #available(iOS 26.0, *) {
        return try await DeviceAiModule.generate(instructions: instructions, prompt: prompt, maxTokens: maxTokens)
      }
      #endif
      throw Exception(name: "DeviceAiUnavailable", description: "이 기기에서는 기기 안 AI를 쓸 수 없어요 (iOS 26 이상 필요).", code: "ERR_UNAVAILABLE")
    }
  }

  static func json(_ status: String, _ reason: String? = nil) -> String {
    var d: [String: String] = ["status": status, "engine": "apple"]
    if let reason = reason { d["reason"] = reason }
    let data = (try? JSONSerialization.data(withJSONObject: d)) ?? Data()
    return String(data: data, encoding: .utf8) ?? "{}"
  }

  static func status() -> String {
    #if canImport(FoundationModels)
    if #available(iOS 26.0, *) {
      let model = SystemLanguageModel.default
      switch model.availability {
      case .available:
        if !model.supportsLocale(Locale(identifier: "ko_KR")) {
          return json("unavailable", "language")
        }
        return json("available")
      case .unavailable(.deviceNotEligible):
        return json("unavailable", "device")
      case .unavailable(.appleIntelligenceNotEnabled):
        return json("unavailable", "disabled")
      case .unavailable(.modelNotReady):
        return json("not-ready")
      case .unavailable:
        return json("unavailable", "unknown")
      }
    }
    #endif
    return json("unavailable", "os")
  }

  #if canImport(FoundationModels)
  @available(iOS 26.0, *)
  static func generate(instructions: String, prompt: String, maxTokens: Int) async throws -> String {
    // 일감마다 새 대화: 앞 일감이 문맥 창(약 4천 토큰)을 차지하지 않게
    let session = LanguageModelSession(instructions: instructions)
    let options = GenerationOptions(temperature: 0.3, maximumResponseTokens: maxTokens > 0 ? maxTokens : nil)
    do {
      let response = try await session.respond(to: prompt, options: options)
      return response.content
    } catch let error as LanguageModelSession.GenerationError {
      if case .exceededContextWindowSize = error {
        throw Exception(name: "DeviceAiContext", description: "일감이 기기 안 AI가 한 번에 읽기에는 너무 길어요.", code: "ERR_CONTEXT")
      }
      if case .guardrailViolation = error {
        throw Exception(name: "DeviceAiRefused", description: "기기 안 AI가 이 내용에 답하지 않았어요.", code: "ERR_REFUSED")
      }
      if case .unsupportedLanguageOrLocale = error {
        throw Exception(name: "DeviceAiLanguage", description: "기기 안 AI가 이 언어를 지원하지 않아요.", code: "ERR_LANGUAGE")
      }
      if case .assetsUnavailable = error {
        throw Exception(name: "DeviceAiNotReady", description: "기기 안 AI 모델이 아직 준비되지 않았어요.", code: "ERR_NOT_READY")
      }
      throw Exception(name: "DeviceAiFailed", description: error.localizedDescription, code: "ERR_FAILED")
    }
  }
  #endif
}
