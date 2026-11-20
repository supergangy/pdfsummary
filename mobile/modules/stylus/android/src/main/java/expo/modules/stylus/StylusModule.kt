package expo.modules.stylus

import android.content.Context
import android.view.MotionEvent
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView

// S펜 옆 단추: 안쪽 화면에 오는 펜 이벤트(닿기·떠 있기)를 엿보아 단추가 눌렸는지 알린다.
// 펜을 화면에 대기 전(떠 있을 때)부터 알 수 있어, 단추를 누른 채 쓰면 처음부터 지우개가 된다.
class StylusModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("Stylus")
    View(StylusView::class) {
      Events("onButton")
    }
  }
}

class StylusView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val onButton by EventDispatcher()
  private var pressed = false

  private fun watch(ev: MotionEvent) {
    if (ev.pointerCount < 1) return
    val tool = ev.getToolType(0)
    if (tool != MotionEvent.TOOL_TYPE_STYLUS && tool != MotionEvent.TOOL_TYPE_ERASER) return
    val mask = MotionEvent.BUTTON_STYLUS_PRIMARY or MotionEvent.BUTTON_STYLUS_SECONDARY or MotionEvent.BUTTON_SECONDARY
    // 펜 뒤쪽 지우개 끝(TOOL_TYPE_ERASER)도 지우개로
    val now = (ev.buttonState and mask) != 0 || tool == MotionEvent.TOOL_TYPE_ERASER
    if (now != pressed) {
      pressed = now
      onButton(mapOf("pressed" to now))
    }
  }

  override fun dispatchTouchEvent(ev: MotionEvent): Boolean {
    watch(ev)
    return super.dispatchTouchEvent(ev)
  }

  override fun dispatchGenericMotionEvent(ev: MotionEvent): Boolean {
    watch(ev) // 펜이 화면 위에 떠 있을 때(호버)
    return super.dispatchGenericMotionEvent(ev)
  }
}
