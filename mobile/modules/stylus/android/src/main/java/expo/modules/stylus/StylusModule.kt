package expo.modules.stylus

import android.content.Context
import android.app.Activity
import android.os.SystemClock
import android.util.Log
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.Window
import android.widget.EditText
import android.widget.FrameLayout
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView

// S펜 옆 단추: 안쪽 화면에 오는 펜 이벤트(닿기·떠 있기)를 엿보아 단추가 눌렸는지 알린다.
// 펜을 화면에 대기 전(떠 있을 때)부터 알 수 있어, 단추를 누른 채 쓰면 처음부터 지우개가 된다.
// hover: 펜이 화면에 닿지 않고 떠 있을 때 바뀐 것인지 (떠 있을 때 두 번 누르면 도구 바꾸기)
// hoverEvents를 켜면 펜(마우스)이 떠 있는 자리도 알린다 (onHover: 창 기준 dp 좌표, 떠났으면 exit) — 도구 모음 단추 이름표용.
// (안드로이드 기본 툴팁 View.tooltipText는 갤럭시탭에서 S펜을 띄워도 뜨지 않았다)
class StylusModule : Module() {
  fun emitKey(name: String, ctrl: Boolean, ev: KeyEvent) =
    sendEvent("onKey", mapOf("key" to name, "ctrl" to ctrl, "shift" to ev.isShiftPressed, "alt" to ev.isAltPressed, "repeat" to (ev.repeatCount > 0)))

  override fun definition() = ModuleDefinition {
    Name("Stylus")
    // 키보드(블루투스·북커버 키보드) 단축키: 창의 키 입력을 엿보아 JS로 알린다.
    // React Native에는 전체 키 이벤트가 없어서 창의 Window.Callback을 감싼다 (MainActivity를 고치지 않아도 된다).
    // 글 쓰는 칸(EditText)에 입력 중이면 건드리지 않는다.
    // 키보드(방향키·터치패드 달린 것)를 꽂으면 안드로이드가 화면(Activity)을 새로 만들 수 있어서,
    // 앞으로 나올 때마다 다시 단다 (한 번만 달면 새 화면에서는 단축키가 하나도 안 먹었다)
    Events("onKey")
    Function("listenKeys") {
      wantKeys = true
      val act = appContext.currentActivity ?: return@Function false
      act.runOnUiThread { attachKeys(act) }
      true
    }
    OnActivityEntersForeground {
      if (!wantKeys) return@OnActivityEntersForeground
      val act = appContext.currentActivity ?: return@OnActivityEntersForeground
      act.runOnUiThread { attachKeys(act) }
    }
    View(StylusView::class) {
      Events("onButton", "onHover")
      Prop("hoverEvents") { view: StylusView, on: Boolean -> view.hoverEvents = on }
    }
  }
}

/** 창의 키 입력을 먼저 본다. on이 true면 그 키는 여기서 끝 */
class KeyTap(private val base: Window.Callback, val on: (KeyEvent) -> Boolean) : Window.Callback by base {
  override fun dispatchKeyEvent(event: KeyEvent): Boolean {
    if (on(event)) return true
    return base.dispatchKeyEvent(event)
  }
}

/**
 * 보이지 않는 1×1 칸. 다른 칸(글 쓰는 칸 등)이 초점을 갖지 않을 때 초점을 쥐고 있다가 키를 가장 먼저 받는다.
 * 이게 없으면 펜·손으로 화면을 만진 뒤 처음 누른 화살표·PageUp·Home 키를 안드로이드가
 * '키보드 조작 모드로 바꾸기'에 써 버려 앱까지 오지 않았다 (두 번 눌러야 한 쪽 넘어감).
 * 키보드 앱(삼성 키보드)보다도 먼저 받는다.
 */
class KeyCatcher(context: Context, private val on: (KeyEvent) -> Boolean) : View(context) {
  init {
    isFocusable = true
    isFocusableInTouchMode = true
    importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO
    defaultFocusHighlightEnabled = false
  }
  override fun dispatchKeyEventPreIme(event: KeyEvent): Boolean = on(event) || super.dispatchKeyEventPreIme(event)
  override fun onWindowFocusChanged(hasWindowFocus: Boolean) {
    super.onWindowFocusChanged(hasWindowFocus)
    if (hasWindowFocus) grabIfFree()
  }
  /** 아무도 초점을 갖지 않았으면 쥔다 (글 쓰는 칸에서 빠져나온 뒤 등) */
  fun grabIfFree() {
    post { if (rootView.findFocus() == null) requestFocus() }
  }
}

/** 이 화면(Activity)에 키 받는 장치를 단다. 이미 달려 있으면 그대로 */
private var wantKeys = false
private var lastKey = Triple(0L, 0L, 0)

fun StylusModule.attachKeys(act: Activity) {
  val w = act.window ?: return
  val handle = { ev: KeyEvent ->
    if (act.currentFocus is EditText) false
    else {
      val name = keyName(ev)
      if (name == null) false
      else {
        val ctrl = ev.isCtrlPressed || ev.isMetaPressed
        // 같은 키가 두 곳(먼저 받는 칸·창)을 거쳐도 한 번만 알린다
        val id = Triple(ev.downTime, ev.eventTime, ev.keyCode)
        if (ev.action == KeyEvent.ACTION_DOWN && lastKey != id) {
          lastKey = id
          if (consumes(name, ctrl)) Log.i("PdfKeys", "단축키 " + (if (ctrl) "Ctrl+" else "") + name)
          emitKey(name, ctrl, ev)
        }
        // 앱이 쓰는 키는 안드로이드 기본 동작(단추 사이 초점 옮기기 등)으로 넘기지 않는다
        consumes(name, ctrl)
      }
    }
  }
  if (w.callback !is KeyTap) w.callback = KeyTap(w.callback, handle)
  val decor = w.decorView as? ViewGroup ?: return
  var catcher: KeyCatcher? = null
  for (i in 0 until decor.childCount) (decor.getChildAt(i) as? KeyCatcher)?.let { catcher = it }
  if (catcher == null) {
    val c = KeyCatcher(act, handle)
    decor.addView(c, FrameLayout.LayoutParams(1, 1))
    // 글 쓰는 칸 등에서 초점이 빠져 아무도 없으면 다시 쥔다
    decor.viewTreeObserver.addOnGlobalFocusChangeListener { _, now -> if (now == null) c.grabIfFree() }
    catcher = c
  }
  catcher?.grabIfFree()
}

/** 키 이름: 글자·숫자는 소문자 한 글자, 그 밖에는 이름 (앱이 쓰지 않는 키는 null) */
fun keyName(ev: KeyEvent): String? = when (ev.keyCode) {
  KeyEvent.KEYCODE_PAGE_UP -> "PageUp"
  KeyEvent.KEYCODE_PAGE_DOWN -> "PageDown"
  KeyEvent.KEYCODE_DPAD_LEFT -> "ArrowLeft"
  KeyEvent.KEYCODE_DPAD_RIGHT -> "ArrowRight"
  KeyEvent.KEYCODE_MOVE_HOME -> "Home"
  KeyEvent.KEYCODE_MOVE_END -> "End"
  KeyEvent.KEYCODE_DEL -> "Backspace"
  KeyEvent.KEYCODE_FORWARD_DEL -> "Delete"
  KeyEvent.KEYCODE_EQUALS, KeyEvent.KEYCODE_PLUS, KeyEvent.KEYCODE_NUMPAD_ADD -> "+"
  KeyEvent.KEYCODE_MINUS, KeyEvent.KEYCODE_NUMPAD_SUBTRACT -> "-"
  KeyEvent.KEYCODE_SLASH -> "/"
  in KeyEvent.KEYCODE_A..KeyEvent.KEYCODE_Z -> ((ev.keyCode - KeyEvent.KEYCODE_A) + 97).toChar().toString()
  in KeyEvent.KEYCODE_0..KeyEvent.KEYCODE_9 -> ((ev.keyCode - KeyEvent.KEYCODE_0) + 48).toChar().toString()
  else -> null
}

/** 앱이 쓰는 키: Ctrl 조합은 모두, 그 밖에는 쪽 넘기기·지우기·도구 글자 */
fun consumes(name: String, ctrl: Boolean): Boolean =
  ctrl || name in setOf("PageUp", "PageDown", "ArrowLeft", "ArrowRight", "Home", "End", "Backspace", "Delete", "p", "h", "e", "l", "t")

class StylusView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val onButton by EventDispatcher()
  private val onHover by EventDispatcher()
  private var pressed = false
  var hoverEvents = false
  private var lastHover = 0L
  private val winLoc = IntArray(2)

  /** 펜이 떠 있는 자리를 JS로 (움직임은 40ms에 한 번만, 들어옴·떠남은 바로) */
  private fun reportHover(ev: MotionEvent) {
    val a = ev.actionMasked
    if (a != MotionEvent.ACTION_HOVER_ENTER && a != MotionEvent.ACTION_HOVER_MOVE && a != MotionEvent.ACTION_HOVER_EXIT) return
    val now = SystemClock.uptimeMillis()
    if (a == MotionEvent.ACTION_HOVER_MOVE && now - lastHover < 40) return
    lastHover = now
    val d = resources.displayMetrics.density
    getLocationInWindow(winLoc) // 창 기준으로 (JS의 measureInWindow와 같은 기준)
    onHover(mapOf("x" to (winLoc[0] + ev.x) / d, "y" to (winLoc[1] + ev.y) / d, "exit" to (a == MotionEvent.ACTION_HOVER_EXIT)))
  }

  private fun watch(ev: MotionEvent, hover: Boolean) {
    if (ev.pointerCount < 1) return
    val tool = ev.getToolType(0)
    if (tool != MotionEvent.TOOL_TYPE_STYLUS && tool != MotionEvent.TOOL_TYPE_ERASER) return
    val mask = MotionEvent.BUTTON_STYLUS_PRIMARY or MotionEvent.BUTTON_STYLUS_SECONDARY or MotionEvent.BUTTON_SECONDARY
    // 펜 뒤쪽 지우개 끝(TOOL_TYPE_ERASER)도 지우개로
    val now = (ev.buttonState and mask) != 0 || tool == MotionEvent.TOOL_TYPE_ERASER
    if (now != pressed) {
      pressed = now
      onButton(mapOf("pressed" to now, "hover" to hover))
    }
  }

  override fun dispatchTouchEvent(ev: MotionEvent): Boolean {
    watch(ev, false)
    // 닿으면 떠 있던 펜은 떠난 것 (이름표를 닫는다)
    if (hoverEvents && ev.actionMasked == MotionEvent.ACTION_DOWN) onHover(mapOf("x" to 0f, "y" to 0f, "exit" to true))
    return super.dispatchTouchEvent(ev)
  }

  override fun dispatchGenericMotionEvent(ev: MotionEvent): Boolean {
    watch(ev, true) // 펜이 화면 위에 떠 있을 때(호버)
    if (hoverEvents) reportHover(ev)
    return super.dispatchGenericMotionEvent(ev)
  }
}
