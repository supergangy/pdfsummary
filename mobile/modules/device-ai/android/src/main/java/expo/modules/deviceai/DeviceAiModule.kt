package expo.modules.deviceai

import com.google.mlkit.genai.common.DownloadStatus
import com.google.mlkit.genai.common.FeatureStatus
import com.google.mlkit.genai.common.GenAiException
import com.google.mlkit.genai.prompt.Content
import com.google.mlkit.genai.prompt.GenerateContentRequest
import com.google.mlkit.genai.prompt.Generation
import com.google.mlkit.genai.prompt.GenerativeModel
import com.google.mlkit.genai.prompt.SystemInstruction
import com.google.mlkit.genai.prompt.TextPart
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject

// 갤럭시 등 안드로이드 기기 안 AI(ML Kit Prompt API → AICore의 Gemini Nano)로 짧은 글을 쓴다.
// 인터넷·API 키 없이 기기 안에서 돈다. 지원 기기에서만 쓸 수 있고, 앱이 화면에 떠 있을 때만 돈다.
class DeviceAiModule : Module() {
  private var client: GenerativeModel? = null

  private fun model(): GenerativeModel = client ?: Generation.getClient().also { client = it }

  override fun definition() = ModuleDefinition {
    Name("DeviceAi")
    Events("onDownloadProgress")

    AsyncFunction("getStatusAsync") Coroutine { ->
      status()
    }

    // 모델이 기기에 없으면 받는다 (진행률은 onDownloadProgress 이벤트로)
    AsyncFunction("prepareAsync") Coroutine { ->
      val now = status()
      if (JSONObject(now).getString("status") != "downloadable") {
        return@Coroutine now
      }
      var total = 0L
      try {
        model().download().collect { s ->
          when (s) {
            is DownloadStatus.DownloadStarted -> {
              total = s.bytesToDownload
              sendEvent("onDownloadProgress", mapOf("ratio" to 0.0))
            }
            is DownloadStatus.DownloadProgress -> {
              val r = if (total > 0) (s.totalBytesDownloaded.toDouble() / total).coerceIn(0.0, 1.0) else null
              sendEvent("onDownloadProgress", mapOf("ratio" to r))
            }
            DownloadStatus.DownloadCompleted -> sendEvent("onDownloadProgress", mapOf("ratio" to 1.0))
            is DownloadStatus.DownloadFailed -> throw coded(s.e)
          }
        }
      } catch (e: GenAiException) {
        throw coded(e)
      }
      status()
    }

    AsyncFunction("generateAsync") Coroutine { instructions: String, prompt: String, maxTokens: Int ->
      generate(instructions, prompt, maxTokens)
    }

    OnDestroy {
      client?.close()
      client = null
    }
  }

  private suspend fun status(): String {
    val st = try {
      when (model().checkStatus()) {
        FeatureStatus.AVAILABLE -> "available"
        FeatureStatus.DOWNLOADABLE -> "downloadable"
        FeatureStatus.DOWNLOADING -> "downloading"
        else -> "unavailable"
      }
    } catch (e: Exception) {
      "unavailable"
    }
    val o = JSONObject().put("status", st).put("engine", "gemini-nano")
    if (st == "unavailable") o.put("reason", "device")
    return o.toString()
  }

  private suspend fun generate(instructions: String, prompt: String, maxTokens: Int): String {
    val m = model()
    if (m.checkStatus() != FeatureStatus.AVAILABLE) {
      throw CodedException("ERR_NOT_READY", "기기 안 AI 모델이 아직 준비되지 않았어요.", null)
    }
    val system = instructions.isNotBlank() && m.isSystemPromptAvailable()
    val input = if (instructions.isNotBlank() && !system) "$instructions\n\n$prompt" else prompt
    val content = Content.Builder().addPart(TextPart(input)).build()
    val request = GenerateContentRequest.Builder(content).apply {
      if (system) systemInstruction = SystemInstruction(instructions)
      if (maxTokens > 0) maxOutputTokens = maxTokens
      temperature = 0.3f
      candidateCount = 1
    }.build()
    return try {
      m.generateContent(request).candidates.firstOrNull()?.text
        ?: throw CodedException("ERR_FAILED", "기기 안 AI가 답을 주지 않았어요.", null)
    } catch (e: GenAiException) {
      throw coded(e)
    }
  }

  private fun coded(e: Throwable): CodedException {
    if (e !is GenAiException) return CodedException("ERR_FAILED", e.message ?: "기기 안 AI 오류", e)
    val (code, msg) = when (e.errorCode) {
      GenAiException.ErrorCode.REQUEST_TOO_LARGE -> "ERR_CONTEXT" to "일감이 기기 안 AI가 한 번에 읽기에는 너무 길어요."
      GenAiException.ErrorCode.BACKGROUND_USE_BLOCKED -> "ERR_BACKGROUND" to "기기 안 AI는 앱이 화면에 떠 있을 때만 돌아요."
      GenAiException.ErrorCode.BUSY,
      GenAiException.ErrorCode.PER_APP_BATTERY_USE_QUOTA_EXCEEDED -> "ERR_BUSY" to "기기 안 AI가 바쁘거나 사용량 한도에 걸렸어요. 잠시 뒤 다시 해 주세요."
      GenAiException.ErrorCode.NOT_AVAILABLE,
      GenAiException.ErrorCode.NEEDS_SYSTEM_UPDATE,
      GenAiException.ErrorCode.AICORE_INCOMPATIBLE -> "ERR_UNAVAILABLE" to "이 기기에서는 기기 안 AI를 쓸 수 없어요 (시스템 업데이트가 필요할 수 있어요)."
      else -> "ERR_FAILED" to (e.message ?: "기기 안 AI 오류")
    }
    return CodedException(code, msg, e)
  }
}
