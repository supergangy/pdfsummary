// 노트 목록: PDF 가져오기, 새 노트(속지 고르기), 열기·이름 바꾸기·지우기
import * as DocumentPicker from "expo-document-picker";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Alert, Image, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { available as pdfAvailable } from "../../modules/pdf-pages";
import type { Picked } from "../platform/types";
import { Button, Chip, floating, Hint, radius, ScreenTitle, styles as ui, type, useTheme, type Theme } from "../ui";
import { keepFolder } from "./app-nav";
import { importPdf } from "./importPdf";
import { PACK_EXT, packNotebook, unpackNotebook } from "./pack";
import { readPicked } from "./readPicked";
import { shareFile } from "./shareFile";
import { blankNotebook, type Notebook, type Paper } from "./model";
import { pageImage } from "./pageImage";
import type { SyncStatus } from "./sync/engine";
import { statusText } from "./sync/SyncSheet";
import type { SyncedStore } from "./sync/syncedStore";

type Props = {
  store: SyncedStore;
  onOpen: (id: string) => void;
  syncStatus: SyncStatus | null; // 동기화가 꺼져 있으면 null
  onSync: () => void;
  onSummaryTool: () => void; // PDF만 넣어 요약하는 화면 (예전 방식)
  onSettings: () => void;
  refresh: number;
  folder: string | null; // 지금 보는 폴더 (null = 전체). 노트를 열었다 돌아와도 남게 App이 들고 있다
  onFolder: (f: string | null) => void;
};

const PAPERS: { value: Paper; label: string }[] = [
  { value: "lined", label: "줄" },
  { value: "grid", label: "모눈" },
  { value: "dotted", label: "점" },
  { value: "plain", label: "무지" },
];

/** 화면 크기에 따른 여백: 넓은 화면(태블릿)은 넉넉하게, 폰은 조금 좁게 */
const WIDE = 700;
const MAX_W = 1200; // 아주 넓은 화면에서는 가운데로 모은다
const MIN_CARD = 180; // 노트 카드의 가장 좁은 너비

/** 창 뒤를 덮는 옅은 그늘 (어두운 모드는 조금 더 진하게) */
const backdrop = (t: Theme) => (t.dark ? "rgba(0,0,0,0.5)" : "rgba(0,0,0,0.25)");

export function Library({ store, onOpen, onSummaryTool, onSettings, refresh, syncStatus, onSync, folder, onFolder: setFolder }: Props) {
  const t = useTheme();
  const { width } = useWindowDimensions();
  const [list, setList] = useState<Notebook[] | null>(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const [actions, setActions] = useState<Notebook | null>(null);
  const [folders, setFolders] = useState<string[]>([]);
  const [folderDialog, setFolderDialog] = useState(false);
  const [moving, setMoving] = useState<Notebook | null>(null);
  const folderRef = useRef(folder);
  folderRef.current = folder;
  const reloadNo = useRef(0);

  const reload = useCallback(() => {
    const no = ++reloadNo.current;
    store.list().then(setList).catch((e) => setErr((e as Error).message));
    store.folders().then((fs) => {
      setFolders(fs);
      // 보던 폴더가 그사이 지워졌으면(다른 기기에서 지운 경우 등) '전체'로.
      // 가장 최근에 읽은 목록으로만 판단한다 (방금 만든 폴더가 아직 없는 옛 목록 때문에 선택이 풀리지 않게)
      if (no === reloadNo.current && keepFolder(folderRef.current, fs) !== folderRef.current) setFolder(null);
    }).catch(() => {});
  }, [store, setFolder]);
  useEffect(reload, [reload, refresh]);
  // 다른 기기에서 노트가 바뀌면 목록도 바로
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null;
    const off = store.subscribe(() => {
      if (t) clearTimeout(t);
      t = setTimeout(reload, 300);
    });
    return () => {
      off();
      if (t) clearTimeout(t);
    };
  }, [store, reload]);

  async function pickPdf() {
    setErr("");
    const res = await DocumentPicker.getDocumentAsync({ type: "application/pdf", copyToCacheDirectory: true, multiple: false });
    if (res.canceled || !res.assets?.length) return;
    const a = res.assets[0];
    await doImport({ uri: a.uri, name: a.name, size: a.size, mimeType: a.mimeType, webFile: a.file });
  }

  async function pickPack() {
    setErr("");
    const res = await DocumentPicker.getDocumentAsync({ type: "*/*", copyToCacheDirectory: true, multiple: false });
    if (res.canceled || !res.assets?.length) return;
    const a = res.assets[0];
    setBusy("노트 파일을 가져오는 중…");
    try {
      const nb = await store.importUnpacked(unpackNotebook(await readPicked({ uri: a.uri, webFile: a.file })));
      if (folder) await store.moveTo(nb.id, folder);
      reload();
      onOpen(nb.id);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function sendPack(nb: Notebook) {
    setActions(null);
    setBusy("노트 파일을 만드는 중…");
    try {
      const full = await store.load(nb.id);
      if (!full) throw new Error("노트를 열 수 없어요.");
      const bytes = packNotebook(full, await store.loadInk(full), full.hasPdf ? await store.pdfBytes(full.id) : null);
      await shareFile(bytes, `${full.title}${PACK_EXT}`, "application/zip");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function doImport(p: Picked) {
    setBusy("PDF를 가져오는 중…");
    try {
      const nb = await importPdf(store, p);
      if (folder) await store.moveTo(nb.id, folder);
      onOpen(nb.id);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function createBlank(paper: Paper, title: string) {
    setNewOpen(false);
    const nb = blankNotebook(title.trim() || "새 노트", paper, 1);
    if (folder) nb.folder = folder;
    await store.create(nb);
    onOpen(nb.id);
  }

  function remove(nb: Notebook) {
    const doIt = async () => {
      setActions(null);
      await store.remove(nb.id);
      reload();
    };
    if (Platform.OS === "web") {
      if (globalThis.confirm?.(`'${nb.title}' 노트를 지울까요? 되돌릴 수 없어요.`) ?? true) void doIt();
    } else {
      Alert.alert(`'${nb.title}' 노트를 지울까요?`, "필기도 함께 지워지고 되돌릴 수 없어요.", [
        { text: "취소", style: "cancel" },
        { text: "지우기", style: "destructive", onPress: () => void doIt() },
      ]);
    }
  }

  async function addFolder(name: string) {
    setFolderDialog(false);
    const n = name.trim();
    if (!n) return;
    await store.saveFolders([...folders, n]);
    setFolder(n);
    reload();
  }

  async function moveNote(nb: Notebook, to: string | undefined) {
    setMoving(null);
    await store.moveTo(nb.id, to);
    reload();
  }

  function deleteFolder(name: string) {
    const doIt = async () => {
      await store.removeFolder(name);
      setFolder(null);
      reload();
    };
    const msg = `'${name}' 폴더를 지울까요? 안의 노트는 지우지 않고 폴더 밖으로 옮겨요.`;
    if (Platform.OS === "web") {
      if (globalThis.confirm?.(msg) ?? true) void doIt();
    } else {
      Alert.alert("폴더 지우기", msg, [{ text: "취소", style: "cancel" }, { text: "지우기", style: "destructive", onPress: () => void doIt() }]);
    }
  }

  const shown = list?.filter((nb) => folder === null || nb.folder === folder) ?? null;
  const counts = new Map<string, number>();
  for (const nb of list ?? []) if (nb.folder) counts.set(nb.folder, (counts.get(nb.folder) ?? 0) + 1);

  // 넓은 화면은 여백·간격을 넉넉하게. 카드 너비는 줄마다 꼭 맞게 나눈다
  const wide = width >= WIDE;
  const pad = wide ? 24 : 16;
  const gap = wide ? 24 : 16;
  const inner = Math.min(width, MAX_W) - pad * 2;
  const cols = Math.max(2, Math.min(6, Math.floor((inner + gap) / (MIN_CARD + gap))));
  const cardW = Math.floor((inner - (cols - 1) * gap) / cols);

  const syncLabel = syncStatus
    ? syncStatus.state === "offline" ? "연결 안 됨" : syncStatus.waiting || syncStatus.state === "syncing" ? "동기화 중" : "동기화됨"
    : "동기화";
  const topButtons = (
    <View style={s.topButtons}>
      <Button small label={syncLabel} accessibilityLabel={syncStatus ? `동기화: ${statusText(syncStatus)}` : "동기화 켜기"} onPress={onSync} />
      <Button small label="설정" onPress={onSettings} />
    </View>
  );
  const subText = "PDF 교재에 바로 필기하고, 칠한 부분만 모아 요약해요.";
  // 폰에서는 단추 네 개를 두 줄로 반씩 나눠 가지런히
  const actionStyle = wide ? undefined : s.actionHalf;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView contentContainerStyle={[s.page, { paddingHorizontal: pad, paddingTop: wide ? 32 : 20 }]}>
        {wide ? (
          <ScreenTitle title="필기 노트" sub={subText} right={topButtons} />
        ) : (
          <View style={{ gap: 4 }}>
            <ScreenTitle title="필기 노트" right={topButtons} />
            <Text style={[type.body, { color: t.muted }]}>{subText}</Text>
          </View>
        )}

        <View style={[s.actions, { marginTop: wide ? 28 : 20 }]}>
          <Button kind="primary" label="PDF 가져오기" onPress={pickPdf} disabled={!pdfAvailable} style={actionStyle} />
          <Button label="＋ 새 노트" onPress={() => setNewOpen(true)} style={actionStyle} />
          <Button label="노트 파일 가져오기" onPress={pickPack} style={actionStyle} />
          <Button label="PDF만 넣어 요약하기" onPress={onSummaryTool} style={actionStyle} />
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: wide ? 28 : 24 }} contentContainerStyle={s.chips}>
          <Chip role="button" label={`전체 ${list?.length ?? ""}`} on={folder === null} onPress={() => setFolder(null)} />
          {folders.map((f) => (
            <Chip key={f} role="button" label={`${f} ${counts.get(f) ?? 0}`} on={folder === f} onPress={() => setFolder(f)} onLongPress={() => deleteFolder(f)} />
          ))}
          <GhostPill label="＋ 폴더" onPress={() => setFolderDialog(true)} />
          {folder !== null && <GhostPill label="폴더 지우기" onPress={() => deleteFolder(folder)} />}
        </ScrollView>
        {!pdfAvailable && <Hint style={{ marginTop: 12 }}>이 앱(Expo Go 등)에서는 PDF를 열 수 없어요. 개발용 빌드에서 쓸 수 있어요. 빈 노트는 쓸 수 있어요.</Hint>}
        {!!err && <Hint color={t.bad} style={{ marginTop: 12 }}>{err}</Hint>}

        <View style={{ marginTop: wide ? 24 : 20 }}>
          {shown === null ? (
            <ActivityIndicator color={t.muted} style={{ marginTop: 48 }} />
          ) : shown.length === 0 && folder !== null ? (
            <Empty>
              <Text style={[type.body, { color: t.muted, textAlign: "center" }]}>이 폴더에 노트가 없어요. 노트의 ⋯ → '폴더로 옮기기'로 넣을 수 있어요.</Text>
            </Empty>
          ) : shown.length === 0 ? (
            <Empty>
              <Text style={[type.title, { color: t.ink, textAlign: "center" }]}>아직 노트가 없어요</Text>
              <Text style={[type.body, { color: t.muted, textAlign: "center" }]}>
                교재 PDF를 가져오거나 새 노트를 만들어 보세요.{"\n"}굿노트·삼성노트 등에서 PDF를 공유 → '필기 요약'으로 보내도 돼요.
              </Text>
            </Empty>
          ) : (
            <View style={[s.grid, { columnGap: gap, rowGap: wide ? 32 : 24 }]}>
              {shown.map((nb) => (
                <NoteCard key={nb.id} nb={nb} store={store} width={cardW} onPress={() => onOpen(nb.id)} onMore={() => setActions(nb)} />
              ))}
            </View>
          )}
        </View>
      </ScrollView>

      {!!busy && (
        <View style={[s.busyWrap, { backgroundColor: backdrop(t) }]}>
          <View style={[floating(t), s.busyBox]}>
            <ActivityIndicator color={t.ink} />
            <Text style={[type.body, { color: t.ink }]}>{busy}</Text>
          </View>
        </View>
      )}

      <NewNoteDialog visible={newOpen} onCancel={() => setNewOpen(false)} onCreate={createBlank} />
      <NameDialog visible={folderDialog} title="새 폴더" placeholder="폴더 이름 (예: 정보처리기사)" onCancel={() => setFolderDialog(false)} onDone={addFolder} />
      <Modal visible={!!moving} transparent animationType="fade" onRequestClose={() => setMoving(null)}>
        <Pressable style={[s.backdrop, { backgroundColor: backdrop(t) }]} onPress={() => setMoving(null)}>
          <Pressable style={[floating(t), s.menu]} onPress={() => {}}>
            <Text style={[type.heading, s.menuHead, { color: t.ink }]}>어느 폴더로 옮길까요?</Text>
            {folders.map((f) => (
              <MenuItem key={f} label={`${f}${moving?.folder === f ? " (지금)" : ""}`} muted={moving?.folder === f} onPress={() => moving && moveNote(moving, f)} />
            ))}
            <MenuItem label="폴더 밖으로" onPress={() => moving && moveNote(moving, undefined)} />
            {!folders.length && <Text style={[type.caption, s.menuNote, { color: t.muted }]}>먼저 '＋ 폴더'로 폴더를 만들어 주세요.</Text>}
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={!!actions} transparent animationType="fade" onRequestClose={() => setActions(null)}>
        <Pressable style={[s.backdrop, { backgroundColor: backdrop(t) }]} onPress={() => setActions(null)}>
          <Pressable style={[floating(t), s.menu]} onPress={() => {}}>
            <Text style={[type.heading, s.menuHead, { color: t.ink }]} numberOfLines={1}>{actions?.title}</Text>
            <MenuItem label="열기" onPress={() => actions && onOpen(actions.id)} />
            <MenuItem label="폴더로 옮기기" onPress={() => { setMoving(actions); setActions(null); }} />
            <MenuItem label="다른 기기로 보내기 (노트 파일)" onPress={() => actions && sendPack(actions)} />
            <View style={[s.menuLine, { backgroundColor: t.lineSoft }]} />
            <MenuItem label="노트 지우기" danger onPress={() => actions && remove(actions)} />
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

function NoteCard({ nb, store, width, onPress, onMore }: { nb: Notebook; store: SyncedStore; width: number; onPress: () => void; onMore: () => void }) {
  const t = useTheme();
  const [thumb, setThumb] = useState<string | null>(null);
  const first = nb.pages[0];
  useEffect(() => {
    let alive = true;
    if (nb.hasPdf && first?.pdf !== undefined) {
      store.pdfUri(nb.id)
        .then((u) => pageImage(nb.id, u, first.pdf!, 512))
        .then((u) => alive && setThumb(u))
        .catch(() => {});
    }
    return () => {
      alive = false;
    };
  }, [nb.id, nb.hasPdf, first?.pdf, store]);
  const h = width * Math.min(1.5, (first?.h ?? 842) / (first?.w ?? 595));
  const date = new Date(nb.updated);
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onMore}
      accessibilityRole="button"
      accessibilityLabel={`${nb.title} 열기`}
      style={({ pressed }) => ({ width, opacity: pressed ? 0.85 : 1 })}
    >
      {/* 쪽 그림은 종이라서 어두운 모드에서도 흰 바탕 */}
      <View style={[s.thumb, { width, height: h, borderColor: t.lineSoft }]}>
        {thumb ? (
          <Image source={{ uri: thumb }} style={{ width: "100%", height: "100%" }} resizeMode="cover" />
        ) : (
          <PaperThumb paper={first?.paper} />
        )}
      </View>
      <View style={s.cardFoot}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[type.label, s.cardTitle, { color: t.ink }]} numberOfLines={1}>{nb.title}</Text>
          <Text style={[type.caption, { color: t.muted }]}>
            {nb.pages.length}쪽 · {date.getMonth() + 1}/{date.getDate()} {String(date.getHours()).padStart(2, "0")}:{String(date.getMinutes()).padStart(2, "0")}
          </Text>
        </View>
        <Pressable
          onPress={onMore}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={`${nb.title} 더 보기`}
          style={({ pressed }) => [s.more, pressed && { backgroundColor: t.sunken }]}
        >
          <Text style={{ color: t.muted, fontSize: 18, lineHeight: 20 }}>⋯</Text>
        </Pressable>
      </View>
    </Pressable>
  );
}

/** 빈 노트의 겉모습: 속지 무늬를 옅게 (줄·모눈·점, 무지는 비워 둔다). small = 새 노트 창의 작은 견본 */
function PaperThumb({ paper, small }: { paper?: Paper; small?: boolean }) {
  const rows = small ? 7 : 12;
  if (paper === "lined") {
    return (
      <View style={[s.paperFill, s.paperCol, { paddingHorizontal: small ? 8 : 12 }]}>
        {Array.from({ length: rows }, (_, i) => <View key={i} style={[s.paperLine, { backgroundColor: PAPER_LINE }]} />)}
      </View>
    );
  }
  if (paper === "grid") {
    const cols = small ? 5 : 8;
    return (
      <View style={s.paperFill}>
        <View style={[StyleSheet.absoluteFill, s.paperCol]}>
          {Array.from({ length: rows + 2 }, (_, i) => <View key={i} style={[s.paperLine, { backgroundColor: PAPER_GRID }]} />)}
        </View>
        <View style={[StyleSheet.absoluteFill, s.paperRow]}>
          {Array.from({ length: cols }, (_, i) => <View key={i} style={{ width: 1, backgroundColor: PAPER_GRID }} />)}
        </View>
      </View>
    );
  }
  if (paper === "dotted") {
    const cols = small ? 5 : 7;
    return (
      <View style={[s.paperFill, s.paperCol]}>
        {Array.from({ length: rows }, (_, r) => (
          <View key={r} style={s.paperRow}>
            {Array.from({ length: cols }, (_, c) => <View key={c} style={[s.dot, { backgroundColor: PAPER_DOT }]} />)}
          </View>
        ))}
      </View>
    );
  }
  return null;
}

// 속지 무늬 색 (종이 위라서 모드와 관계없이 같다)
const PAPER_LINE = "#CFDDEB";
const PAPER_GRID = "#E1E7EE";
const PAPER_DOT = "#B9C3CD";

function NewNoteDialog({ visible, onCancel, onCreate }: { visible: boolean; onCancel: () => void; onCreate: (p: Paper, title: string) => void }) {
  const t = useTheme();
  const [paper, setPaper] = useState<Paper>("lined");
  const [title, setTitle] = useState("");
  useEffect(() => {
    if (visible) setTitle("");
  }, [visible]);
  return (
    <Dialog visible={visible} onCancel={onCancel} title="새 노트" maxWidth={460}>
      <TextInput
        value={title}
        onChangeText={setTitle}
        placeholder="노트 이름 (예: 정보처리기사 오답)"
        placeholderTextColor={t.muted}
        accessibilityLabel="새 노트 이름"
        style={[ui.input, { borderColor: t.line, color: t.ink, backgroundColor: t.card }]}
      />
      <Text style={[type.label, { color: t.ink, marginTop: 24, marginBottom: 12 }]}>속지</Text>
      <View style={s.papers}>
        {PAPERS.map((p) => {
          const on = paper === p.value;
          return (
            <Pressable
              key={p.value}
              onPress={() => setPaper(p.value)}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              style={({ pressed }) => [s.paperPick, { opacity: pressed ? 0.75 : 1 }]}
            >
              {/* 고른 속지는 검은 테두리로 감싼다 (어두운 모드에서는 흰 테두리) */}
              <View style={[s.paperRing, { borderColor: on ? t.ink : "transparent" }]}>
                <View style={[s.paperSample, { borderColor: t.line }]}>
                  <PaperThumb paper={p.value} small />
                </View>
              </View>
              <Text style={[type.caption, { color: on ? t.ink : t.muted, fontWeight: on ? "700" : "500" }]}>{p.label}</Text>
            </Pressable>
          );
        })}
      </View>
      <View style={s.dialogButtons}>
        <Button label="취소" onPress={onCancel} />
        <Button kind="primary" label="만들기" onPress={() => onCreate(paper, title)} />
      </View>
    </Dialog>
  );
}

function NameDialog({ visible, title, placeholder, onCancel, onDone }: { visible: boolean; title: string; placeholder: string; onCancel: () => void; onDone: (v: string) => void }) {
  const t = useTheme();
  const [v, setV] = useState("");
  useEffect(() => {
    if (visible) setV("");
  }, [visible]);
  return (
    <Dialog visible={visible} onCancel={onCancel} title={title} maxWidth={420}>
      <TextInput
        value={v}
        onChangeText={setV}
        autoFocus
        placeholder={placeholder}
        placeholderTextColor={t.muted}
        accessibilityLabel={title}
        onSubmitEditing={() => onDone(v)}
        style={[ui.input, { borderColor: t.line, color: t.ink, backgroundColor: t.card }]}
      />
      <View style={s.dialogButtons}>
        <Button label="취소" onPress={onCancel} />
        <Button kind="primary" label="만들기" onPress={() => onDone(v)} />
      </View>
    </Dialog>
  );
}

/** 가운데 뜨는 창 (바탕을 눌러도 닫히지 않는다) */
function Dialog({ visible, onCancel, title, maxWidth, children }: { visible: boolean; onCancel: () => void; title: string; maxWidth: number; children: ReactNode }) {
  const t = useTheme();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={[s.backdrop, { backgroundColor: backdrop(t) }]}>
        <View style={[floating(t), s.dialog, { maxWidth }]}>
          <Text style={[type.title, { color: t.ink, marginBottom: 20 }]}>{title}</Text>
          {children}
        </View>
      </View>
    </Modal>
  );
}

/** 메뉴 한 줄. danger = 지우기처럼 되돌릴 수 없는 일, muted = 지금 상태라 고를 필요 없는 것 */
function MenuItem({ label, onPress, danger, muted }: { label: string; onPress: () => void; danger?: boolean; muted?: boolean }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="menuitem" style={({ pressed }) => [s.menuItem, pressed && { backgroundColor: t.sunken }]}>
      <Text style={[type.body, { color: danger ? t.bad : muted ? t.muted : t.ink }]}>{label}</Text>
    </Pressable>
  );
}

/** 폴더 줄 끝의 '할 일' 알약 (폴더 추가·지우기): 고르는 칩과 헷갈리지 않게 바탕 없이 테두리만 */
function GhostPill({ label, onPress }: { label: string; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [ui.chip, s.ghost, { borderColor: t.line, opacity: pressed ? 0.6 : 1 }]}
    >
      <Text style={{ color: t.sub, fontSize: 14, fontWeight: "500", letterSpacing: -0.2 }}>{label}</Text>
    </Pressable>
  );
}

/** 노트가 없을 때: 옅은 테두리 상자 안에 조용히 가운데 정렬 */
function Empty({ children }: { children: ReactNode }) {
  const t = useTheme();
  return <View style={[s.empty, { borderColor: t.lineSoft }]}>{children}</View>;
}

const s = StyleSheet.create({
  page: { paddingBottom: 64, width: "100%", maxWidth: MAX_W, alignSelf: "center" },
  topButtons: { flexDirection: "row", gap: 8, alignSelf: "center" },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  actionHalf: { flexGrow: 1, flexBasis: "40%", paddingHorizontal: 10 },
  chips: { gap: 8, alignItems: "center" },
  ghost: { borderWidth: 1, backgroundColor: "transparent", paddingVertical: 7 },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  empty: { borderWidth: 1, borderRadius: radius.xl, paddingVertical: 56, paddingHorizontal: 20, alignItems: "center", gap: 8 },

  thumb: { borderRadius: radius.md, borderWidth: 1, overflow: "hidden", backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center" },
  cardFoot: { flexDirection: "row", alignItems: "center", marginTop: 12, gap: 4 },
  cardTitle: { fontSize: 15, fontWeight: "700", letterSpacing: -0.2 },
  more: { width: 32, height: 32, borderRadius: radius.sm, alignItems: "center", justifyContent: "center" },

  paperFill: { width: "100%", height: "100%" },
  paperCol: { justifyContent: "space-evenly" },
  paperRow: { flexDirection: "row", justifyContent: "space-evenly" },
  paperLine: { height: 1 },
  dot: { width: 3, height: 3, borderRadius: 1.5 },

  backdrop: { flex: 1, alignItems: "center", justifyContent: "center", padding: 20 },
  dialog: { borderRadius: radius.xl, padding: 24, width: "100%" },
  dialogButtons: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 28 },
  papers: { flexDirection: "row", gap: 12 },
  paperPick: { flex: 1, alignItems: "center", gap: 8 },
  paperRing: { width: "100%", borderWidth: 2, borderRadius: radius.md, padding: 2 },
  paperSample: { aspectRatio: 3 / 4, borderWidth: 1, borderRadius: radius.sm, overflow: "hidden", backgroundColor: "#FFFFFF" },

  menu: { borderRadius: radius.xl, minWidth: 280, maxWidth: 360, paddingVertical: 8 },
  menuHead: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8 },
  menuItem: { marginHorizontal: 8, paddingHorizontal: 12, paddingVertical: 12, borderRadius: radius.md },
  menuNote: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 12 },
  menuLine: { height: 1, marginHorizontal: 20, marginVertical: 6 },

  busyWrap: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, alignItems: "center", justifyContent: "center" },
  busyBox: { paddingVertical: 20, paddingHorizontal: 24, borderRadius: radius.lg, flexDirection: "row", gap: 12, alignItems: "center" },
});
