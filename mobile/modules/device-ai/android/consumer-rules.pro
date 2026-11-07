# ML Kit이 매니페스트로 찾아 인자 없이 만드는 클래스 (R8이 생성자를 지우지 않게)
-keep class com.google.mlkit.common.internal.CommonComponentRegistrar {
  public <init>();
}
