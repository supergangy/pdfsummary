package expo.modules.stylus

import android.content.Context
import android.os.SystemClock
import android.view.MotionEvent
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView

// S펜 옆 단추: 안쪽 화면에 오는 펜 이벤트(닿기·떠 있기)를 엿보아 단추가 눌렸는지 알린다.
// 펜을 화면에 대기 전(떠 있을 때)부터 알 수 있어, 단추를 누른 채 쓰면 처음부터 지우개가 된다.
// hover: 펜이 화면에 닿지 않고 떠 있을 때 바뀐 것인지 (떠 있을 때 두 번 누르면 도구 바꾸기)
// hoverEvents를 켜면 펜(마우스)이 떠 있는 자리도 알린다 (onHover: dp 좌표, 떠났으면 exit) — 도구 모음 단추 이름표용.
// (안드로이드 기본 툴팁 View.tooltipText는 갤럭시탭에서 S펜을 띄워도 뜨지 않았다)
class StylusModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("Stylus")
    View(StylusView::class) {
      Events("onButton", "onHover")
      Prop("hoverEvents") { view: StylusView, on: Boolean -> view.hoverEvents = on }
    }
  }
}

class StylusView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val onButton by EventDispatcher()
  private val onHover by EventDispatcher()
  private var pressed = false
  var hoverEvents = false
  private var lastHover = 0L

  /** 펜이 떠 있는 자리를 JS로 (움직임은 40ms에 한 번만, 들어옴·떠남은 바로) */
  private fun reportHover(ev: MotionEvent) {
    val a = ev.actionMasked
    if (a != MotionEvent.ACTION_HOVER_ENTER && a != MotionEvent.ACTION_HOVER_MOVE && a != MotionEvent.ACTION_HOVER_EXIT) return
    val now = SystemClock.uptimeMillis()
    if (a == MotionEvent.ACTION_HOVER_MOVE && now - lastHover < 40) return
    lastHover = now
    val d = resources.displayMetrics.density
    onHover(mapOf("x" to ev.x / d, "y" to ev.y / d, "exit" to (a == MotionEvent.ACTION_HOVER_EXIT)))
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
