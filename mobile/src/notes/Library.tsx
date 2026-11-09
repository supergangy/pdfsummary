// 노트 목록: PDF 가져오기, 새 노트(속지 고르기), 열기·이름 바꾸기·지우기
import * as DocumentPicker from "expo-document-picker";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Image, Modal, Platform, Pressable, ScrollView, Text, TextInput, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { available as pdfAvailable } from "../../modules/pdf-pages";
import type { Picked } from "../platform/types";
import { Button, Hint, useTheme } from "../ui";
import { importPdf } from "./importPdf";
import { PACK_EXT, packNotebook, unpackNotebook } from "./pack";
import { readPicked } from "./readPicked";
import { shareFile } from "./shareFile";
import { blankNotebook, type Notebook, type Paper } from "./model";
import { pageImage } from "./pageImage";
import type { NoteStore } from "./store";

type Props = {
  store: NoteStore;
  onOpen: (id: string) => void;
  onSummaryTool: () => void; // PDF만 넣어 요약하는 화면 (예전 방식)
  onSettings: () => void;
  refresh: number;
};

const PAPERS: { value: Paper; label: string }[] = [
  { value: "lined", label: "줄" },
  { value: "grid", label: "모눈" },
  { value: "dotted", label: "점" },
  { value: "plain", label: "무지" },
];

export function Library({ store, onOpen, onSummaryTool, onSettings, refresh }: Props) {
  const t = useTheme();
  const { width } = useWindowDimensions();
  const [list, setList] = useState<Notebook[] | null>(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const [actions, setActions] = useState<Notebook | null>(null);
  const [folders, setFolders] = useState<string[]>([]);
  const [folder, setFolder] = useState<string | null>(null); // 지금 보는 폴더 (null = 전체)
  const [folderDialog, setFolderDialog] = useState(false);
  const [moving, setMoving] = useState<Notebook | null>(null);

  const reload = useCallback(() => {
    store.list().then(setList).catch((e) => setErr((e as Error).message));
    store.folders().then(setFolders).catch(() => {});
  }, [store]);
  useEffect(reload, [reload, refresh]);

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

  const cols = Math.max(2, Math.min(6, Math.floor((Math.min(width, 1200) - 32) / 180)));
  const cardW = (Math.min(width, 1200) - 32 - (cols - 1) * 14) / cols;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60, width: "100%", maxWidth: 1200, alignSelf: "center" }}>
        <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8, marginTop: 6, marginBottom: 16 }}>
          <View style={{ flex: 1, minWidth: 200 }}>
            <Text style={{ color: t.ink, fontSize: 26, fontWeight: "800" }}>📚 필기 노트</Text>
            <Text style={{ color: t.muted, marginTop: 2 }}>PDF 교재에 바로 필기하고, 칠한 부분만 모아 요약해요.</Text>
          </View>
          <Button label="설정" onPress={onSettings} style={{ paddingVertical: 8 }} />
        </View>

        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 18 }}>
          <Button kind="primary" label="📄 PDF 가져오기" onPress={pickPdf} disabled={!pdfAvailable} />
          <Button label="＋ 새 노트" onPress={() => setNewOpen(true)} />
          <Button label="📦 노트 파일 가져오기" onPress={pickPack} />
          <Button label="✨ PDF만 넣어 요약하기" onPress={onSummaryTool} />
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 14 }}>
          <Chip label={`전체 ${list?.length ?? ""}`} on={folder === null} onPress={() => setFolder(null)} />
          {folders.map((f) => (
            <Chip key={f} label={`📁 ${f} ${counts.get(f) ?? 0}`} on={folder === f} onPress={() => setFolder(f)} onLongPress={() => deleteFolder(f)} />
          ))}
          <Chip label="＋ 폴더" on={false} onPress={() => setFolderDialog(true)} />
          {folder !== null && <Chip label="폴더 지우기" on={false} onPress={() => deleteFolder(folder)} />}
        </ScrollView>
        {!pdfAvailable && <Hint>이 앱(Expo Go 등)에서는 PDF를 열 수 없어요. 개발용 빌드에서 쓸 수 있어요. 빈 노트는 쓸 수 있어요.</Hint>}
        {!!err && <Hint color={t.bad} style={{ marginBottom: 10 }}>{err}</Hint>}

        {shown === null ? (
          <ActivityIndicator color={t.accent} style={{ marginTop: 30 }} />
        ) : shown.length === 0 && folder !== null ? (
          <Text style={{ color: t.muted, paddingVertical: 30, textAlign: "center" }}>이 폴더에 노트가 없어요. 노트의 ⋯ → '폴더로 옮기기'로 넣을 수 있어요.</Text>
        ) : shown.length === 0 ? (
          <View style={{ alignItems: "center", paddingVertical: 40, gap: 8 }}>
            <Text style={{ fontSize: 40 }}>📝</Text>
            <Text style={{ color: t.ink, fontSize: 17, fontWeight: "600" }}>아직 노트가 없어요</Text>
            <Text style={{ color: t.muted, textAlign: "center" }}>
              교재 PDF를 가져오거나 새 노트를 만들어 보세요.{"\n"}굿노트·삼성노트 등에서 PDF를 공유 → '필기 요약'으로 보내도 돼요.
            </Text>
          </View>
        ) : (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 14 }}>
            {shown.map((nb) => (
              <NoteCard key={nb.id} nb={nb} store={store} width={cardW} onPress={() => onOpen(nb.id)} onMore={() => setActions(nb)} />
            ))}
          </View>
        )}
      </ScrollView>

      {!!busy && (
        <View style={{ position: "absolute", inset: 0, backgroundColor: "rgba(0,0,0,0.25)", alignItems: "center", justifyContent: "center" }}>
          <View style={{ backgroundColor: t.card, padding: 20, borderRadius: 12, flexDirection: "row", gap: 10, alignItems: "center" }}>
            <ActivityIndicator color={t.accent} />
            <Text style={{ color: t.ink }}>{busy}</Text>
          </View>
        </View>
      )}

      <NewNoteDialog visible={newOpen} onCancel={() => setNewOpen(false)} onCreate={createBlank} />
      <NameDialog visible={folderDialog} title="새 폴더" placeholder="폴더 이름 (예: 정보처리기사)" onCancel={() => setFolderDialog(false)} onDone={addFolder} />
      <Modal visible={!!moving} transparent animationType="fade" onRequestClose={() => setMoving(null)}>
        <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.3)", alignItems: "center", justifyContent: "center", padding: 20 }} onPress={() => setMoving(null)}>
          <Pressable style={{ backgroundColor: t.card, borderRadius: 12, minWidth: 260, paddingVertical: 6 }} onPress={() => {}}>
            <Text style={{ color: t.muted, paddingHorizontal: 16, paddingVertical: 10 }}>어느 폴더로 옮길까요?</Text>
            {folders.map((f) => (
              <Pressable key={f} onPress={() => moving && moveNote(moving, f)} style={{ paddingHorizontal: 16, paddingVertical: 12 }} accessibilityRole="menuitem">
                <Text style={{ color: moving?.folder === f ? t.accent : t.ink, fontSize: 15 }}>📁 {f}{moving?.folder === f ? " (지금)" : ""}</Text>
              </Pressable>
            ))}
            <Pressable onPress={() => moving && moveNote(moving, undefined)} style={{ paddingHorizontal: 16, paddingVertical: 12 }} accessibilityRole="menuitem">
              <Text style={{ color: t.ink, fontSize: 15 }}>폴더 밖으로</Text>
            </Pressable>
            {!folders.length && <Text style={{ color: t.muted, paddingHorizontal: 16, paddingBottom: 10 }}>먼저 '＋ 폴더'로 폴더를 만들어 주세요.</Text>}
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={!!actions} transparent animationType="fade" onRequestClose={() => setActions(null)}>
        <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.3)", alignItems: "center", justifyContent: "center", padding: 20 }} onPress={() => setActions(null)}>
          <Pressable style={{ backgroundColor: t.card, borderRadius: 12, minWidth: 260, paddingVertical: 6 }} onPress={() => {}}>
            <Text style={{ color: t.muted, paddingHorizontal: 16, paddingVertical: 10 }} numberOfLines={1}>{actions?.title}</Text>
            <Pressable onPress={() => actions && onOpen(actions.id)} style={{ paddingHorizontal: 16, paddingVertical: 12 }} accessibilityRole="menuitem">
              <Text style={{ color: t.ink, fontSize: 15 }}>열기</Text>
            </Pressable>
            <Pressable onPress={() => { setMoving(actions); setActions(null); }} style={{ paddingHorizontal: 16, paddingVertical: 12 }} accessibilityRole="menuitem">
              <Text style={{ color: t.ink, fontSize: 15 }}>📁 폴더로 옮기기</Text>
            </Pressable>
            <Pressable onPress={() => actions && sendPack(actions)} style={{ paddingHorizontal: 16, paddingVertical: 12 }} accessibilityRole="menuitem">
              <Text style={{ color: t.ink, fontSize: 15 }}>📦 다른 기기로 보내기 (노트 파일)</Text>
            </Pressable>
            <Pressable onPress={() => actions && remove(actions)} style={{ paddingHorizontal: 16, paddingVertical: 12 }} accessibilityRole="menuitem">
              <Text style={{ color: t.bad, fontSize: 15 }}>🗑 노트 지우기</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

function NoteCard({ nb, store, width, onPress, onMore }: { nb: Notebook; store: NoteStore; width: number; onPress: () => void; onMore: () => void }) {
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
      <View style={{ width, height: h, borderRadius: 8, overflow: "hidden", backgroundColor: "#fff", borderWidth: 1, borderColor: t.line, alignItems: "center", justifyContent: "center" }}>
        {thumb ? (
          <Image source={{ uri: thumb }} style={{ width: "100%", height: "100%" }} resizeMode="cover" />
        ) : (
          <PaperThumb paper={first?.paper} />
        )}
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", marginTop: 6 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: t.ink, fontWeight: "600" }} numberOfLines={1}>{nb.title}</Text>
          <Text style={{ color: t.muted, fontSize: 12 }}>
            {nb.pages.length}쪽 · {date.getMonth() + 1}/{date.getDate()} {String(date.getHours()).padStart(2, "0")}:{String(date.getMinutes()).padStart(2, "0")}
          </Text>
        </View>
        <Pressable onPress={onMore} hitSlop={10} accessibilityRole="button" accessibilityLabel={`${nb.title} 더 보기`}>
          <Text style={{ color: t.muted, fontSize: 20, paddingHorizontal: 4 }}>⋯</Text>
        </Pressable>
      </View>
    </Pressable>
  );
}

function PaperThumb({ paper }: { paper?: Paper }) {
  const lines = Array.from({ length: 9 });
  if (paper === "lined") {
    return (
      <View style={{ width: "100%", height: "100%", paddingTop: 22 }}>
        {lines.map((_, i) => <View key={i} style={{ height: 1, backgroundColor: "#C9DCF0", marginHorizontal: 10, marginBottom: 12 }} />)}
      </View>
    );
  }
  if (paper === "grid" || paper === "dotted") {
    return <Text style={{ color: "#B8C2CC", fontSize: 30 }}>{paper === "grid" ? "▦" : "⁘"}</Text>;
  }
  return <Text style={{ color: "#C8CCD2", fontSize: 30 }}>📄</Text>;
}

function NewNoteDialog({ visible, onCancel, onCreate }: { visible: boolean; onCancel: () => void; onCreate: (p: Paper, title: string) => void }) {
  const t = useTheme();
  const [paper, setPaper] = useState<Paper>("lined");
  const [title, setTitle] = useState("");
  useEffect(() => {
    if (visible) setTitle("");
  }, [visible]);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.3)", alignItems: "center", justifyContent: "center", padding: 20 }}>
        <View style={{ backgroundColor: t.card, borderRadius: 12, padding: 18, width: "100%", maxWidth: 440 }}>
          <Text style={{ color: t.ink, fontWeight: "700", fontSize: 18, marginBottom: 12 }}>새 노트</Text>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="노트 이름 (예: 정보처리기사 오답)"
            placeholderTextColor={t.muted}
            accessibilityLabel="새 노트 이름"
            style={{ borderWidth: 1, borderColor: t.line, borderRadius: 8, padding: 10, color: t.ink, fontSize: 16, marginBottom: 14 }}
          />
          <Text style={{ color: t.ink, fontWeight: "600", marginBottom: 8 }}>속지</Text>
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            {PAPERS.map((p) => (
              <Pressable
                key={p.value}
                onPress={() => setPaper(p.value)}
                accessibilityRole="radio"
                accessibilityState={{ selected: paper === p.value }}
                style={{ paddingHorizontal: 16, paddingVertical: 9, borderRadius: 8, borderWidth: 1, borderColor: paper === p.value ? t.accent : t.line, backgroundColor: paper === p.value ? t.soft : t.card }}
              >
                <Text style={{ color: paper === p.value ? t.accent : t.ink, fontWeight: "600" }}>{p.label}</Text>
              </Pressable>
            ))}
          </View>
          <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
            <Button label="취소" onPress={onCancel} />
            <Button kind="primary" label="만들기" onPress={() => onCreate(paper, title)} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

function Chip({ label, on, onPress, onLongPress }: { label: string; on: boolean; onPress: () => void; onLongPress?: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18, borderWidth: 1, borderColor: on ? t.accent : t.line, backgroundColor: on ? t.accent : t.card }}
    >
      <Text style={{ color: on ? t.accentInk : t.ink, fontWeight: "600" }}>{label}</Text>
    </Pressable>
  );
}

function NameDialog({ visible, title, placeholder, onCancel, onDone }: { visible: boolean; title: string; placeholder: string; onCancel: () => void; onDone: (v: string) => void }) {
  const t = useTheme();
  const [v, setV] = useState("");
  useEffect(() => {
    if (visible) setV("");
  }, [visible]);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.3)", alignItems: "center", justifyContent: "center", padding: 20 }}>
        <View style={{ backgroundColor: t.card, borderRadius: 12, padding: 18, width: "100%", maxWidth: 420 }}>
          <Text style={{ color: t.ink, fontWeight: "700", fontSize: 17, marginBottom: 10 }}>{title}</Text>
          <TextInput
            value={v}
            onChangeText={setV}
            autoFocus
            placeholder={placeholder}
            placeholderTextColor={t.muted}
            accessibilityLabel={title}
            onSubmitEditing={() => onDone(v)}
            style={{ borderWidth: 1, borderColor: t.line, borderRadius: 8, padding: 10, color: t.ink, fontSize: 16 }}
          />
          <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
            <Button label="취소" onPress={onCancel} />
            <Button kind="primary" label="만들기" onPress={() => onDone(v)} />
          </View>
        </View>
      </View>
    </Modal>
  );
}
