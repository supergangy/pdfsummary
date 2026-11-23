package expo.modules.stylus

import android.content.Context
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.views.ExpoView

// 도구 모음 단추 이름표: 안드로이드 기본 툴팁(View.tooltipText)을 단 감싸개.
// S펜(또는 마우스)을 화면에 대지 않고 단추 위에 띄우면 잠시 뒤 이름이 뜨고, 손가락으로 길게 눌러도 뜬다.
// 안쪽 단추들은 툴팁이 없어서, 펜이 떠 있는 자리의 툴팁 찾기(dispatchTooltipHoverEvent)가 이 감싸개까지 올라온다.
class TooltipModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("Tooltip")
    View(TooltipView::class) {
      Prop("text") { view: TooltipView, text: String? ->
        view.tooltipText = text?.takeIf { it.isNotBlank() }
      }
    }
  }
}

class TooltipView(context: Context, appContext: AppContext) : ExpoView(context, appContext)
