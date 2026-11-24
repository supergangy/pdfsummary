// 노트 목록: PDF 가져오기, 새 노트(속지 고르기), 열기·이름 바꾸기·지우기.
// 폴더는 디렉터리처럼: 넓은 화면은 왼쪽에 폴더 나무(폴더 안의 폴더, 접고 펴기), 위에 경로(폴더 › 공부 › NCS),
// 가운데에 그 폴더의 아래 폴더와 노트를 네모 칸 바둑판으로. 폴더 계산은 folders.ts
import * as DocumentPicker from "expo-document-picker";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
import { allFolders, ALL_NOTES, childrenOf, cleanName, crumbs, isWithin, joinPath, nameOf, parentOf, renamePath, treeRows } from "./folders";
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
  folder: string | null; // 지금 보는 폴더 경로 (null = 맨 위 폴더, ALL_NOTES = 모든 노트). 노트를 열었다 돌아와도 남게 App이 들고 있다
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
const MIN_CARD = 160; // 노트·폴더 칸의 가장 좁은 너비
const SIDE = 840; // 이보다 넓으면 왼쪽에 폴더 나무

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
  const [newIn, setNewIn] = useState<string | null | undefined>(undefined); // 새 폴더 창: 어느 폴더 안에 (undefined = 닫힘)
  const [renaming, setRenaming] = useState<string | null>(null); // 이름 바꿀 폴더
  const [folderMenu, setFolderMenu] = useState<string | null>(null); // ⋯ 메뉴를 연 폴더
  const [moving, setMoving] = useState<Notebook | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set()); // 왼쪽 나무에서 펼친 폴더
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
      // (노트가 들어 있는 폴더는 목록에 없어도 있는 것으로: 다른 기기에서 아직 폴더 목록이 안 온 경우)
      if (no === reloadNo.current) {
        store.list().then((l) => {
          const all = allFolders(fs, l.map((nb) => nb.folder));
          if (keepFolder(folderRef.current, all) !== folderRef.current) setFolder(null);
        }).catch(() => {});
      }
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

  /** 지금 보는 진짜 폴더 (맨 위·모든 노트면 null) */
  const here = folder && folder !== ALL_NOTES ? folder : null;
  const tree = useMemo(() => allFolders(folders, (list ?? []).map((nb) => nb.folder)), [folders, list]);
  // 지금 폴더의 윗 폴더들은 나무에서 펼쳐 둔다
  useEffect(() => {
    if (!here) return;
    setOpen((o) => {
      const n = new Set(o);
      for (let p = parentOf(here); p; p = parentOf(p)) n.add(p);
      return n.size === o.size ? o : n;
    });
  }, [here]);

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
      if (here) await store.moveTo(nb.id, here);
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
      if (here) await store.moveTo(nb.id, here);
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
    if (here) nb.folder = here;
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

  async function addFolder(parent: string | null, name: string) {
    setNewIn(undefined);
    const n = cleanName(name);
    if (!n) return;
    const path = joinPath(parent, n);
    if (!tree.includes(path)) await store.saveFolders([...tree, path]);
    if (parent) setOpen((o) => new Set(o).add(parent));
    setFolder(path);
    reload();
  }

  async function moveNote(nb: Notebook, to: string | undefined) {
    setMoving(null);
    await store.moveTo(nb.id, to);
    reload();
  }

  /** 폴더 이름 바꾸기: 아래 폴더와 노트의 경로도 함께 */
  async function renameFolder(from: string, name: string) {
    setRenaming(null);
    const n = cleanName(name);
    if (!n) return;
    const to = joinPath(parentOf(from), n);
    if (to === from) return;
    if (tree.includes(to)) {
      setErr(`'${n}' 폴더가 이미 있어요.`);
      return;
    }
    setBusy("폴더 이름을 바꾸는 중…");
    try {
      for (const nb of list ?? []) if (nb.folder && isWithin(nb.folder, from)) await store.moveTo(nb.id, renamePath(nb.folder, from, to));
      await store.saveFolders(tree.map((f) => renamePath(f, from, to)));
      if (folder && isWithin(folder, from)) setFolder(renamePath(folder, from, to));
      reload();
    } finally {
      setBusy("");
    }
  }

  /** 폴더 지우기: 안의 폴더도 지우고, 안의 노트는 지우지 않고 윗 폴더(맨 위면 폴더 밖)로 옮긴다 */
  function deleteFolder(path: string) {
    setFolderMenu(null);
    const up = parentOf(path);
    const doIt = async () => {
      setBusy("폴더를 지우는 중…");
      try {
        for (const nb of list ?? []) if (isWithin(nb.folder, path)) await store.moveTo(nb.id, up ?? undefined);
        await store.saveFolders(tree.filter((f) => !isWithin(f, path)));
        if (folder && isWithin(folder, path)) setFolder(up);
        reload();
      } finally {
        setBusy("");
      }
    };
    const msg = `'${nameOf(path)}' 폴더를 지울까요? 안의 폴더도 함께 지워요. 노트는 지우지 않고 ${up ? `'${nameOf(up)}' 폴더로` : "폴더 밖으로"} 옮겨요.`;
    if (Platform.OS === "web") {
      if (globalThis.confirm?.(msg) ?? true) void doIt();
    } else {
      Alert.alert("폴더 지우기", msg, [{ text: "취소", style: "cancel" }, { text: "지우기", style: "destructive", onPress: () => void doIt() }]);
    }
  }

  const all = folder === ALL_NOTES;
  const shown = list?.filter((nb) => all || (nb.folder ?? null) === here) ?? null;
  const subFolders = all ? [] : childrenOf(tree, here);
  const counts = new Map<string, number>(); // 폴더 → 바로 안의 노트 수
  for (const nb of list ?? []) if (nb.folder) counts.set(nb.folder, (counts.get(nb.folder) ?? 0) + 1);
  const toggle = (f: string) => setOpen((o) => {
    const n = new Set(o);
    if (n.has(f)) n.delete(f);
    else n.add(f);
    return n;
  });

  // 넓은 화면은 여백·간격을 넉넉하게. 칸 너비는 줄마다 꼭 맞게 나눈다 (왼쪽 폴더 나무만큼 빼고)
  const wide = width >= WIDE;
  const side = width >= SIDE;
  const sideW = side ? Math.min(300, Math.round(width * 0.22)) : 0;
  const pad = wide ? 24 : 16;
  const gap = wide ? 20 : 14;
  const inner = Math.min(width - sideW, MAX_W) - pad * 2;
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

  const sideBar = (
    <ScrollView style={[s.side, { width: sideW, borderColor: t.lineSoft, backgroundColor: t.sunken }]} contentContainerStyle={s.sideIn}>
      <SideRow label="모든 노트" count={list?.length} on={all} onPress={() => setFolder(ALL_NOTES)} a11y="모든 노트" icon="all" />
      <View style={[s.sideLine, { backgroundColor: t.lineSoft }]} />
      <View style={s.sideHead}>
        <View style={{ flex: 1 }}>
          <SideRow label="폴더" on={folder === null} onPress={() => setFolder(null)} a11y="맨 위 폴더" icon="folder" />
        </View>
        <Pressable onPress={() => setNewIn(null)} accessibilityRole="button" accessibilityLabel="새 폴더 만들기" hitSlop={8} style={({ pressed }) => [s.sidePlus, pressed && { backgroundColor: t.bg }]}>
          <Text style={{ color: t.sub, fontSize: 20, lineHeight: 22 }}>＋</Text>
        </Pressable>
      </View>
      {treeRows(tree, open).map((r) => (
        <SideRow
          key={r.path}
          label={nameOf(r.path)}
          count={counts.get(r.path) ?? 0}
          depth={r.depth + 1}
          on={folder === r.path}
          kids={r.hasKids ? open.has(r.path) : undefined}
          onToggle={() => toggle(r.path)}
          onPress={() => {
            setFolder(r.path);
            if (r.hasKids && !open.has(r.path)) toggle(r.path);
          }}
          onLongPress={() => setFolderMenu(r.path)}
          a11y={`${nameOf(r.path)} 폴더, 노트 ${counts.get(r.path) ?? 0}개`}
          icon="folder"
        />
      ))}
    </ScrollView>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <View style={s.body}>
      {side && sideBar}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={[s.page, { paddingHorizontal: pad, paddingTop: wide ? 32 : 20 }]}>
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

        {/* 경로: 폴더 › 공부 › NCS (누르면 그 폴더로). 끝에 새 폴더·이 폴더 ⋯ */}
        <View style={[s.pathRow, { marginTop: wide ? 28 : 22, backgroundColor: t.sunken }]}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.crumbs} style={{ flex: 1 }}>
            {all ? (
              <Text style={[type.label, { color: t.ink, fontWeight: "700" }]}>모든 노트</Text>
            ) : (
              <>
                <Crumb label="폴더" on={!here} onPress={() => setFolder(null)} />
                {crumbs(here).map((c) => (
                  <View key={c.path} style={s.crumbStep}>
                    <Text style={{ color: t.muted, fontSize: 16 }}>›</Text>
                    <Crumb label={c.name} on={c.path === here} onPress={() => setFolder(c.path)} />
                  </View>
                ))}
              </>
            )}
          </ScrollView>
          {!side && !all && <GhostPill label="모든 노트" onPress={() => setFolder(ALL_NOTES)} />}
          {!side && all && <GhostPill label="폴더 보기" onPress={() => setFolder(null)} />}
          {!all && <GhostPill label="＋ 폴더" onPress={() => setNewIn(here)} />}
          {here && <GhostPill label="폴더 ⋯" onPress={() => setFolderMenu(here)} />}
        </View>
        {!pdfAvailable && <Hint style={{ marginTop: 12 }}>이 앱(Expo Go 등)에서는 PDF를 열 수 없어요. 개발용 빌드에서 쓸 수 있어요. 빈 노트는 쓸 수 있어요.</Hint>}
        {!!err && <Hint color={t.bad} style={{ marginTop: 12 }}>{err}</Hint>}

        <View style={{ marginTop: wide ? 24 : 20 }}>
          {shown === null ? (
            <ActivityIndicator color={t.muted} style={{ marginTop: 48 }} />
          ) : shown.length === 0 && subFolders.length === 0 && here !== null ? (
            <Empty>
              <Text style={[type.body, { color: t.muted, textAlign: "center" }]}>이 폴더에 노트가 없어요. 노트의 ⋯ → '폴더로 옮기기'로 넣거나, 이 폴더를 연 채로 PDF를 가져오세요.</Text>
            </Empty>
          ) : shown.length === 0 && subFolders.length === 0 ? (
            <Empty>
              <Text style={[type.title, { color: t.ink, textAlign: "center" }]}>아직 노트가 없어요</Text>
              <Text style={[type.body, { color: t.muted, textAlign: "center" }]}>
                교재 PDF를 가져오거나 새 노트를 만들어 보세요.{"\n"}굿노트·삼성노트 등에서 PDF를 공유 → '필기 요약'으로 보내도 돼요.
              </Text>
            </Empty>
          ) : (
            <View style={[s.grid, { columnGap: gap, rowGap: wide ? 28 : 22 }]}>
              {subFolders.map((f) => (
                <FolderCard
                  key={f}
                  name={nameOf(f)}
                  notes={counts.get(f) ?? 0}
                  folders={childrenOf(tree, f).length}
                  width={cardW}
                  onPress={() => setFolder(f)}
                  onMore={() => setFolderMenu(f)}
                />
              ))}
              {shown.map((nb) => (
                <NoteCard key={nb.id} nb={nb} store={store} width={cardW} onPress={() => onOpen(nb.id)} onMore={() => setActions(nb)} />
              ))}
            </View>
          )}
        </View>
      </ScrollView>
      </View>

      {!!busy && (
        <View style={[s.busyWrap, { backgroundColor: backdrop(t) }]}>
          <View style={[floating(t), s.busyBox]}>
            <ActivityIndicator color={t.ink} />
            <Text style={[type.body, { color: t.ink }]}>{busy}</Text>
          </View>
        </View>
      )}

      <NewNoteDialog visible={newOpen} onCancel={() => setNewOpen(false)} onCreate={createBlank} />
      <NameDialog
        visible={newIn !== undefined}
        title={newIn ? `'${nameOf(newIn)}' 안에 새 폴더` : "새 폴더"}
        placeholder="폴더 이름 (예: 정보처리기사)"
        onCancel={() => setNewIn(undefined)}
        onDone={(v) => addFolder(newIn ?? null, v)}
      />
      <NameDialog
        visible={renaming !== null}
        title="폴더 이름 바꾸기"
        initial={renaming ? nameOf(renaming) : ""}
        action="바꾸기"
        placeholder="폴더 이름"
        onCancel={() => setRenaming(null)}
        onDone={(v) => renaming && renameFolder(renaming, v)}
      />
      <Modal visible={folderMenu !== null} transparent animationType="fade" onRequestClose={() => setFolderMenu(null)}>
        <Pressable style={[s.backdrop, { backgroundColor: backdrop(t) }]} onPress={() => setFolderMenu(null)}>
          <Pressable style={[floating(t), s.menu]} onPress={() => {}}>
            <Text style={[type.heading, s.menuHead, { color: t.ink }]} numberOfLines={1}>{folderMenu ? nameOf(folderMenu) : ""}</Text>
            <MenuItem label="열기" onPress={() => { if (folderMenu) setFolder(folderMenu); setFolderMenu(null); }} />
            <MenuItem label="안에 새 폴더" onPress={() => { setNewIn(folderMenu); setFolderMenu(null); }} />
            <MenuItem label="이름 바꾸기" onPress={() => { setRenaming(folderMenu); setFolderMenu(null); }} />
            <View style={[s.menuLine, { backgroundColor: t.lineSoft }]} />
            <MenuItem label="폴더 지우기" danger onPress={() => folderMenu && deleteFolder(folderMenu)} />
          </Pressable>
        </Pressable>
      </Modal>
      <Modal visible={!!moving} transparent animationType="fade" onRequestClose={() => setMoving(null)}>
        <Pressable style={[s.backdrop, { backgroundColor: backdrop(t) }]} onPress={() => setMoving(null)}>
          <Pressable style={[floating(t), s.menu]} onPress={() => {}}>
            <Text style={[type.heading, s.menuHead, { color: t.ink }]}>어느 폴더로 옮길까요?</Text>
            <ScrollView style={{ maxHeight: 420 }}>
              {treeRows(tree, new Set(tree)).map((r) => (
                <MenuItem
                  key={r.path}
                  label={`${nameOf(r.path)}${moving?.folder === r.path ? " (지금)" : ""}`}
                  indent={r.depth}
                  a11y={`'${r.path}'(으)로 옮기기`}
                  muted={moving?.folder === r.path}
                  onPress={() => moving && moveNote(moving, r.path)}
                />
              ))}
            </ScrollView>
            <MenuItem label="폴더 밖으로" onPress={() => moving && moveNote(moving, undefined)} />
            {!tree.length && <Text style={[type.caption, s.menuNote, { color: t.muted }]}>먼저 '＋ 폴더'로 폴더를 만들어 주세요.</Text>}
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
  const ratio = (first?.h ?? 842) / (first?.w ?? 595); // 쪽 그림은 칸 폭에 맞추고 위쪽부터 보인다 (네모 칸)
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
      <View style={[s.thumb, { width, height: width, borderColor: t.lineSoft }]}>
        {thumb ? (
          <Image source={{ uri: thumb }} style={{ position: "absolute", top: 0, left: 0, width, height: width * ratio }} resizeMode="stretch" />
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

/** 폴더 칸: 노트 칸과 같은 네모에 큰 폴더 모양, 밑에 이름과 안에 든 것 수 */
function FolderCard({ name, notes, folders, width, onPress, onMore }: { name: string; notes: number; folders: number; width: number; onPress: () => void; onMore: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onMore}
      accessibilityRole="button"
      accessibilityLabel={`${name} 폴더 열기`}
      style={({ pressed }) => ({ width, opacity: pressed ? 0.85 : 1 })}
    >
      <View style={[s.thumb, s.folderBox, { width, height: width, borderColor: t.lineSoft, backgroundColor: t.sunken }]}>
        <FolderGlyph size={width * 0.42} color={t.muted} />
      </View>
      <View style={s.cardFoot}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[type.label, s.cardTitle, { color: t.ink }]} numberOfLines={1}>{name}</Text>
          <Text style={[type.caption, { color: t.muted }]}>{folders ? `폴더 ${folders} · ` : ""}노트 {notes}</Text>
        </View>
        <Pressable
          onPress={onMore}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={`${name} 폴더 더 보기`}
          style={({ pressed }) => [s.more, pressed && { backgroundColor: t.sunken }]}
        >
          <Text style={{ color: t.muted, fontSize: 18, lineHeight: 20 }}>⋯</Text>
        </Pressable>
      </View>
    </Pressable>
  );
}

/** 폴더 모양 (탭이 달린 둥근 네모) */
function FolderGlyph({ size, color, filled }: { size: number; color: string; filled?: boolean }) {
  const w = size, h = size * 0.78, tab = size * 0.42, th = size * 0.14, bw = Math.max(1.5, size * 0.07);
  return (
    <View style={{ width: w, height: h + th * 0.6 }}>
      <View style={{ position: "absolute", left: 0, top: 0, width: tab, height: th * 1.6, borderTopLeftRadius: th * 0.5, borderTopRightRadius: th * 0.5, borderWidth: bw, borderColor: color, backgroundColor: filled ? color : "transparent" }} />
      <View style={{ position: "absolute", left: 0, top: th * 0.6, width: w, height: h, borderRadius: size * 0.1, borderWidth: bw, borderColor: color, backgroundColor: filled ? color : "transparent" }} />
    </View>
  );
}

/** 왼쪽 나무의 한 줄: 펼치기 꺾쇠(아래 폴더가 있을 때) · 폴더 모양 · 이름 · 노트 수 */
function SideRow({ label, count, on, depth = 0, kids, onToggle, onPress, onLongPress, a11y, icon }: {
  label: string; count?: number; on: boolean; depth?: number; kids?: boolean; onToggle?: () => void; onPress: () => void; onLongPress?: () => void; a11y: string; icon: "folder" | "all";
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityState={{ selected: on }}
      style={({ pressed }) => [s.sideRow, { paddingLeft: 8 + depth * 16, backgroundColor: on ? t.bg : pressed ? t.bg : "transparent" }]}
    >
      <Pressable onPress={onToggle} disabled={kids === undefined} hitSlop={6} accessibilityLabel={kids === undefined ? undefined : `${label} ${kids ? "접기" : "펼치기"}`} style={s.chev}>
        {kids !== undefined && <Text style={{ color: t.muted, fontSize: 14, transform: [{ rotate: kids ? "90deg" : "0deg" }] }}>›</Text>}
      </Pressable>
      {icon === "folder" ? (
        <FolderGlyph size={18} color={on ? t.ink : t.sub} filled={on} />
      ) : (
        <View style={[s.allGlyph, { borderColor: on ? t.ink : t.sub }]} />
      )}
      <Text style={[type.body, { color: t.ink, flex: 1, fontWeight: on ? "700" : "400" }]} numberOfLines={1}>{label}</Text>
      {count !== undefined && <Text style={[type.caption, { color: t.muted }]}>{count}</Text>}
    </Pressable>
  );
}

/** 경로 단추 하나 (지금 폴더는 굵게) */
function Crumb({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`경로: ${label}`} hitSlop={6} style={({ pressed }) => [s.crumb, pressed && { opacity: 0.6 }]}>
      <Text style={[type.label, { color: on ? t.ink : t.sub, fontWeight: on ? "700" : "500" }]}>{label}</Text>
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

function NameDialog({ visible, title, placeholder, initial = "", action = "만들기", onCancel, onDone }: {
  visible: boolean; title: string; placeholder: string; initial?: string; action?: string; onCancel: () => void; onDone: (v: string) => void;
}) {
  const t = useTheme();
  const [v, setV] = useState("");
  useEffect(() => {
    if (visible) setV(initial);
  }, [visible, initial]);
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
        <Button kind="primary" label={action} onPress={() => onDone(v)} />
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
function MenuItem({ label, onPress, danger, muted, indent = 0, a11y }: { label: string; onPress: () => void; danger?: boolean; muted?: boolean; indent?: number; a11y?: string }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="menuitem" accessibilityLabel={a11y} style={({ pressed }) => [s.menuItem, { paddingLeft: 12 + indent * 18 }, pressed && { backgroundColor: t.sunken }]}>
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
  body: { flex: 1, flexDirection: "row" },
  // 왼쪽 폴더 나무
  side: { flexGrow: 0, borderRightWidth: 1 },
  sideIn: { paddingTop: 28, paddingBottom: 40, paddingHorizontal: 10, gap: 2 },
  sideRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingRight: 10, paddingVertical: 10, borderRadius: radius.md },
  sideHead: { flexDirection: "row", alignItems: "center" },
  sidePlus: { width: 34, height: 34, borderRadius: radius.sm, alignItems: "center", justifyContent: "center" },
  sideLine: { height: 1, marginVertical: 10, marginHorizontal: 8 },
  chev: { width: 14, alignItems: "center" },
  allGlyph: { width: 16, height: 18, borderWidth: 1.6, borderRadius: 3 },
  // 경로 줄
  pathRow: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: radius.xl, paddingVertical: 6, paddingLeft: 16, paddingRight: 6 },
  crumbs: { alignItems: "center", gap: 6 },
  crumbStep: { flexDirection: "row", alignItems: "center", gap: 6 },
  crumb: { paddingVertical: 6, paddingHorizontal: 4 },
  folderBox: { borderWidth: 1 },
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
