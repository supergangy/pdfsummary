package expo.modules.inkrecognizer

import com.google.android.gms.tasks.Task
import com.google.mlkit.common.model.DownloadConditions
import com.google.mlkit.common.model.RemoteModelManager
import com.google.mlkit.vision.digitalink.DigitalInkRecognition
import com.google.mlkit.vision.digitalink.DigitalInkRecognitionModel
import com.google.mlkit.vision.digitalink.DigitalInkRecognitionModelIdentifier
import com.google.mlkit.vision.digitalink.DigitalInkRecognizerOptions
import com.google.mlkit.vision.digitalink.Ink
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

// 손글씨 획을 ML Kit Digital Ink로 읽는다 (획 모양 그대로 인식, 한국어 지원).
class InkRecognizerModule : Module() {
  private fun model(lang: String): DigitalInkRecognitionModel {
    val id = DigitalInkRecognitionModelIdentifier.fromLanguageTag(lang)
      ?: throw CodedException("ERR_LANGUAGE", "이 언어의 손글씨 인식 모델이 없어요: $lang", null)
    return DigitalInkRecognitionModel.builder(id).build()
  }

  override fun definition() = ModuleDefinition {
    Name("InkRecognizer")

    AsyncFunction("statusAsync") Coroutine { lang: String ->
      if (await(RemoteModelManager.getInstance().isModelDownloaded(model(lang)))) "available" else "downloadable"
    }

    // 모델 받기 (처음 한 번, 인터넷 필요)
    AsyncFunction("prepareAsync") Coroutine { lang: String ->
      val m = model(lang)
      try {
        await(RemoteModelManager.getInstance().download(m, DownloadConditions.Builder().build()))
      } catch (e: Exception) {
        throw CodedException("ERR_DOWNLOAD", "손글씨 인식 모델을 받지 못했어요. 인터넷을 확인해 주세요.", e)
      }
      "available"
    }

    // strokes: [[x, y, x, y, …], …]
    AsyncFunction("recognizeAsync") Coroutine { strokes: List<List<Double>>, _: Double, lang: String ->
      val m = model(lang)
      if (!await(RemoteModelManager.getInstance().isModelDownloaded(m))) {
        throw CodedException("ERR_NOT_READY", "손글씨 인식 모델을 먼저 받아야 해요.", null)
      }
      val ink = Ink.builder()
      var t = 0L
      for (s in strokes) {
        if (s.size < 2) continue
        val b = Ink.Stroke.builder()
        var i = 0
        while (i + 1 < s.size) {
          b.addPoint(Ink.Point.create(s[i].toFloat(), s[i + 1].toFloat(), t))
          t += 10
          i += 2
        }
        ink.addStroke(b.build())
        t += 120
      }
      val recognizer = DigitalInkRecognition.getClient(DigitalInkRecognizerOptions.builder(m).build())
      try {
        val result = await(recognizer.recognize(ink.build()))
        result.candidates.firstOrNull()?.text ?: ""
      } finally {
        recognizer.close()
      }
    }
  }

  private suspend fun <T> await(task: Task<T>): T = suspendCancellableCoroutine { cont ->
    task.addOnSuccessListener { cont.resume(it) }
    task.addOnFailureListener { cont.resumeWithException(it) }
  }
}
