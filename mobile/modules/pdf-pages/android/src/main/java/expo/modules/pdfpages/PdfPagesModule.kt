package expo.modules.pdfpages

import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.pdf.PdfRenderer
import android.net.Uri
import android.os.Build
import android.os.ParcelFileDescriptor
import com.google.android.gms.tasks.Task
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.korean.KoreanTextRecognizerOptions
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Coroutine
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.security.MessageDigest

// PDF 쪽 크기를 읽고, 쪽을 그림(JPEG)으로 그린다 (안드로이드 기본 PdfRenderer).
class PdfPagesModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("PdfPages")

    // 파일의 SHA-256 (16진수). 조금씩 읽어서 큰 파일(수백 MB)도 메모리를 안 쓴다 — JS로 통째로 읽으면 OOM
    AsyncFunction("shaAsync") { uri: String ->
      val md = MessageDigest.getInstance("SHA-256")
      FileInputStream(file(uri)).use { ins ->
        val buf = ByteArray(1 shl 20)
        while (true) {
          val n = ins.read(buf)
          if (n <= 0) break
          md.update(buf, 0, n)
        }
      }
      md.digest().joinToString("") { "%02x".format(it) }
    }

    AsyncFunction("infoAsync") { uri: String ->
      open(uri) { r ->
        val out = JSONArray()
        for (i in 0 until r.pageCount) {
          r.openPage(i).use { p -> out.put(JSONObject().put("w", p.width.toDouble()).put("h", p.height.toDouble())) }
        }
        out.toString()
      }
    }

    // 쪽의 글자와 글자 상자 (안드로이드 15 이상만 PDF 글자를 꺼낼 수 있다). 못 하면 null
    AsyncFunction("textAsync") { uri: String, index: Int ->
      if (Build.VERSION.SDK_INT < 35) return@AsyncFunction null
      open(uri) { r ->
        if (index < 0 || index >= r.pageCount) return@open "[]"
        r.openPage(index).use { p -> PageText.json(p) }
      }
    }

    // 쪽의 글만, 상자 없이 (안드로이드 15 이상). 글자 인식 결과의 글자를 바로잡는 데 쓴다. 못 하면 null
    AsyncFunction("plainTextAsync") { uri: String, index: Int ->
      if (Build.VERSION.SDK_INT < 35) return@AsyncFunction null
      open(uri) { r ->
        if (index < 0 || index >= r.pageCount) return@open ""
        r.openPage(index).use { p -> PageText.plain(p) }
      }
    }

    // 글자 인식(OCR)으로 쪽 글자와 글자 상자: 쪽을 크게 그려 ML Kit(한국어)으로 읽는다. textAsync와 같은 모양.
    AsyncFunction("ocrAsync") Coroutine { uri: String, index: Int, widthPx: Int ->
      val (bmp, pageW) = open(uri) { r ->
        if (index < 0 || index >= r.pageCount) throw CodedException("ERR_PAGE", "${index + 1}쪽이 없어요.", null)
        r.openPage(index).use { p ->
          val w = widthPx.coerceIn(800, 3200)
          val h = Math.max(1, Math.round(w.toDouble() * p.height / Math.max(1, p.width)).toInt())
          val b = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
          b.eraseColor(Color.WHITE)
          p.render(b, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
          Pair(b, p.width.toDouble())
        }
      }
      val recognizer = TextRecognition.getClient(KoreanTextRecognizerOptions.Builder().build())
      try {
        val text = await(recognizer.process(InputImage.fromBitmap(bmp, 0)))
        OcrText.json(text, pageW / bmp.width)
      } finally {
        recognizer.close()
        bmp.recycle()
      }
    }

    AsyncFunction("renderAsync") { uri: String, index: Int, widthPx: Int, outPath: String ->
      open(uri) { r ->
        if (index < 0 || index >= r.pageCount) throw CodedException("ERR_PAGE", "${index + 1}쪽이 없어요.", null)
        r.openPage(index).use { p ->
          val w = widthPx.coerceIn(16, 4096)
          val h = Math.max(1, Math.round(w.toDouble() * p.height / Math.max(1, p.width)).toInt())
          val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
          bmp.eraseColor(Color.WHITE)
          p.render(bmp, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
          val out = file(outPath)
          out.parentFile?.mkdirs()
          FileOutputStream(out).use { bmp.compress(Bitmap.CompressFormat.JPEG, 88, it) }
          bmp.recycle()
          Uri.fromFile(out).toString()
        }
      }
    }
  }

  private suspend fun <T> await(task: Task<T>): T = suspendCancellableCoroutine { cont ->
    task.addOnSuccessListener { cont.resume(it) }
    task.addOnFailureListener { cont.resumeWithException(it) }
  }

  private fun file(s: String): File = if (s.startsWith("file://")) File(Uri.parse(s).path!!) else File(s)

  private fun <T> open(uri: String, block: (PdfRenderer) -> T): T {
    val pfd = try {
      ParcelFileDescriptor.open(file(uri), ParcelFileDescriptor.MODE_READ_ONLY)
    } catch (e: Exception) {
      throw CodedException("ERR_OPEN", "PDF를 열 수 없어요.", e)
    }
    val renderer = try {
      PdfRenderer(pfd)
    } catch (e: SecurityException) {
      pfd.close()
      throw CodedException("ERR_LOCKED", "암호가 걸린 PDF예요.", e)
    } catch (e: Exception) {
      pfd.close()
      throw CodedException("ERR_OPEN", "PDF를 열 수 없어요.", e)
    }
    return try {
      synchronized(lock) { block(renderer) }
    } finally {
      renderer.close()
      pfd.close()
    }
  }

  companion object {
    private val lock = Any()   // PdfRenderer는 한 번에 한 쪽만
  }
}
