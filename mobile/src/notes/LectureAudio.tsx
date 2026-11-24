// 강의 녹음: 녹음하면서 필기하면 획마다 '녹음 몇 초에 썼는지'가 붙고, 나중에 필기를 누르면 그때부터 들린다.
// - 녹음 파일은 이 기기의 노트 폴더 안 (store.addRecording). 크기가 커서 동기화하지 않는다
// - 재생 막대: 재생·멈춤, 10초 앞뒤, 위치 막대(눌러서 옮기기), 빠르기, 필기 눌러 듣기, 쪽 따라가기, 녹음 목록
// 필기 ↔ 시각 계산은 audioSync.ts
import {
  RecordingPresets, requestNotificationPermissionsAsync, requestRecordingPermissionsAsync, setAudioModeAsync,
  useAudioPlayer, useAudioPlayerStatus, useAudioRecorder,
} from "expo-audio";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";

import { floating, radius, type, useTheme } from "../ui";
import { clock, type Recording } from "./audioSync";
import { newId } from "./model";
import type { SyncedStore } from "./sync/syncedStore";

/** 말소리면 충분한 품질 (한 시간에 28MB쯤) */
const REC_OPTIONS = { ...RecordingPresets.HIGH_QUALITY, sampleRate: 32000, numberOfChannels: 1, bitRate: 64000 };
const RATES = [1, 1.25, 1.5, 2];

export type LectureAudio = ReturnType<typeof useLectureAudio>;

export function useLectureAudio({ store, nbId, say }: { store: SyncedStore; nbId: string; say: (s: string) => void }) {
  const recorder = useAudioRecorder(REC_OPTIONS);
  const player = useAudioPlayer(null);
  const status = useAudioPlayerStatus(player);
  const [recs, setRecs] = useState<Recording[]>([]);
  const [live, setLive] = useState<{ id: string; start: number } | null>(null); // 녹음 중
  const liveRef = useRef(live);
  liveRef.current = live;
  const [, tick] = useState(0);
  const [cur, setCur] = useState<Recording | null>(null); // 재생 막대에 올린 녹음
  const [rate, setRateState] = useState(1);

  useEffect(() => {
    let alive = true;
    store.recordings(nbId).then((r) => alive && setRecs(r)).catch(() => {});
    return () => {
      alive = false;
    };
  }, [store, nbId]);

  // 녹음 중에는 1초마다 시간 글자를 바꾼다
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [live]);

  const start = useCallback(async () => {
    if (liveRef.current) return;
    try {
      // 처음 누를 때 안드로이드가 '마이크를 허용할까요?'를 묻는다. 전에 '거부'해서 다시 물을 수 없으면 설정을 열어 준다
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) {
        if (perm.canAskAgain) return say("마이크를 허용해야 녹음할 수 있어요. 녹음 단추를 다시 눌러 '허용'을 골라 주세요.");
        Alert.alert("마이크 권한이 꺼져 있어요", "강의를 녹음하려면 설정에서 이 앱의 '마이크'를 허용해 주세요.", [
          { text: "닫기", style: "cancel" },
          { text: "설정 열기", onPress: () => void Linking.openSettings() },
        ]);
        return;
      }
      // 화면이 꺼지거나 다른 앱으로 가도 녹음이 이어지게 (안드로이드는 알림이 떠 있어야 한다)
      if (Platform.OS === "android") await requestNotificationPermissionsAsync().catch(() => undefined);
      player.pause();
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true, allowsBackgroundRecording: true, shouldPlayInBackground: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setLive({ id: newId(), start: Date.now() });
    } catch (e) {
      say(`녹음을 시작하지 못했어요: ${(e as Error).message}`);
    }
  }, [player, recorder, say]);

  /** 녹음 멈추고 노트에 저장. 저장한 녹음을 돌려준다 */
  const stop = useCallback(async (): Promise<Recording | null> => {
    const l = liveRef.current;
    if (!l) return null;
    liveRef.current = null;
    setLive(null);
    try {
      await recorder.stop();
      const uri = recorder.uri;
      if (!uri) throw new Error("녹음 파일이 없어요");
      const ext = uri.split("?")[0].match(/\.(\w{2,4})$/)?.[1] ?? (Platform.OS === "web" ? "webm" : "m4a");
      const rec: Recording = { id: l.id, start: l.start, dur: Date.now() - l.start, ext };
      await store.addRecording(nbId, rec, { uri });
      setRecs(await store.recordings(nbId));
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true, shouldPlayInBackground: true }).catch(() => undefined);
      say(`녹음을 저장했어요 (${clock(rec.dur / 1000)}). 녹음 중에 쓴 필기를 누르면 그때부터 들을 수 있어요.`);
      return rec;
    } catch (e) {
      say(`녹음을 저장하지 못했어요: ${(e as Error).message}`);
      return null;
    }
  }, [recorder, store, nbId, say]);

  /** 지금 녹음 중이면 획에 붙일 녹음 id·시각 */
  const stamp = useCallback((): { rec: string; rt: number } | null => {
    const l = liveRef.current;
    return l ? { rec: l.id, rt: Date.now() - l.start } : null;
  }, []);

  /** 이 녹음을 at초부터 재생 */
  const play = useCallback(async (rec: Recording, at?: number) => {
    if (liveRef.current) return say("녹음 중에는 들을 수 없어요. 녹음을 멈춘 뒤 들어 주세요.");
    try {
      if (cur?.id !== rec.id) {
        player.replace({ uri: await store.recordingUri(nbId, rec) });
        setCur(rec);
      }
      if (at !== undefined) await player.seekTo(at);
      player.setPlaybackRate(rate);
      player.play();
    } catch (e) {
      say(`녹음을 틀지 못했어요: ${(e as Error).message}`);
    }
  }, [cur, player, store, nbId, rate, say]);

  const setRate = useCallback((r: number) => {
    setRateState(r);
    player.setPlaybackRate(r);
  }, [player]);

  const close = useCallback(() => {
    player.pause();
    setCur(null);
  }, [player]);

  const remove = useCallback(async (rec: Recording) => {
    if (cur?.id === rec.id) close();
    await store.removeRecording(nbId, rec.id);
    setRecs(await store.recordings(nbId));
  }, [cur, close, store, nbId]);

  const elapsed = live ? (Date.now() - live.start) / 1000 : 0;
  return { recs, live, elapsed, start, stop, stamp, cur, status, play, close, rate, setRate, remove, player };
}

/** 화면 아래에 뜨는 재생 막대 */
export function PlayerBar({ audio, listening, onListening, follow, onFollow }: {
  audio: LectureAudio; listening: boolean; onListening: (v: boolean) => void; follow: boolean; onFollow: (v: boolean) => void;
}) {
  const t = useTheme();
  const [trackW, setTrackW] = useState(1);
  const [list, setList] = useState(false);
  const { cur, status, player } = audio;
  if (!cur) return null;
  // 웹에서 녹음한 파일은 길이를 모르기도 한다(무한대·NaN) → 녹음할 때 잰 길이로
  const dur = Number.isFinite(status.duration) && status.duration > 0 ? status.duration : cur.dur / 1000;
  const pos = Math.min(dur, status.currentTime);
  const seek = (s: number) => void player.seekTo(Math.max(0, Math.min(dur, s)));
  const nextRate = RATES[(RATES.indexOf(audio.rate) + 1) % RATES.length];
  const n = audio.recs.findIndex((r) => r.id === cur.id) + 1;
  return (
    <View pointerEvents="box-none" style={css.wrap}>
      <View style={[floating(t), css.bar]}>
        <Small label={status.playing ? "❚❚" : "▶"} a11y={status.playing ? "녹음 멈춤" : "녹음 재생"} onPress={() => (status.playing ? player.pause() : player.play())} strong />
        <Small label="−10" a11y="10초 뒤로" onPress={() => seek(pos - 10)} />
        <Small label="+10" a11y="10초 앞으로" onPress={() => seek(pos + 10)} />
        <Pressable
          onLayout={(e: LayoutChangeEvent) => setTrackW(Math.max(1, e.nativeEvent.layout.width))}
          onPress={(e) => seek((e.nativeEvent.locationX / trackW) * dur)}
          accessibilityRole="adjustable"
          accessibilityLabel="재생 위치 (눌러서 옮기기)"
          style={css.track}
        >
          <View style={[css.rail, { backgroundColor: t.line }]}>
            <View style={[css.fill, { width: `${dur ? (pos / dur) * 100 : 0}%`, backgroundColor: t.ink }]} />
          </View>
        </Pressable>
        <Text style={[type.caption, css.time, { color: t.sub }]} accessibilityLabel="재생 시간">{clock(pos)} / {clock(dur)}</Text>
        <Small label={`${audio.rate}×`} a11y={`빠르기 ${audio.rate}배 (누르면 ${nextRate}배)`} onPress={() => audio.setRate(nextRate)} />
        <Small label="필기 눌러 듣기" a11y="필기 눌러 듣기" on={listening} onPress={() => onListening(!listening)} />
        <Small label="쪽 따라가기" a11y="쪽 따라가기" on={follow} onPress={() => onFollow(!follow)} />
        <Small label={`녹음 ${n}/${audio.recs.length}`} a11y="녹음 목록" onPress={() => setList(true)} />
        <Small label="✕" a11y="재생 막대 닫기" onPress={() => { onListening(false); audio.close(); }} />
      </View>
      <Modal visible={list} transparent animationType="fade" onRequestClose={() => setList(false)}>
        <Pressable style={css.back} onPress={() => setList(false)}>
          <Pressable style={[floating(t), css.list]} onPress={() => {}}>
            <Text style={[type.heading, { color: t.ink, padding: 16 }]}>이 노트의 녹음</Text>
            <ScrollView style={{ maxHeight: 360 }}>
              {audio.recs.map((r, i) => {
                const d = new Date(r.start);
                return (
                  <View key={r.id} style={[css.row, { borderColor: t.lineSoft }]}>
                    <Pressable style={{ flex: 1 }} onPress={() => { setList(false); void audio.play(r, 0); }} accessibilityRole="button" accessibilityLabel={`녹음 ${i + 1} 듣기`}>
                      <Text style={[type.body, { color: r.id === cur.id ? t.ink : t.sub, fontWeight: r.id === cur.id ? "700" : "400" }]}>
                        녹음 {i + 1} · {d.getMonth() + 1}/{d.getDate()} {String(d.getHours()).padStart(2, "0")}:{String(d.getMinutes()).padStart(2, "0")} · {clock(r.dur / 1000)}
                      </Text>
                    </Pressable>
                    <Small label="지우기" a11y={`녹음 ${i + 1} 지우기`} onPress={() => void audio.remove(r)} danger />
                  </View>
                );
              })}
            </ScrollView>
            <Text style={[type.caption, { color: t.muted, padding: 16 }]}>녹음은 이 기기에만 있어요 (다른 기기로 동기화되지 않아요).</Text>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function Small({ label, a11y, onPress, on, strong, danger }: { label: string; a11y: string; onPress: () => void; on?: boolean; strong?: boolean; danger?: boolean }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityState={on === undefined ? undefined : { selected: on }}
      hitSlop={4}
      style={({ pressed }) => [css.small, { backgroundColor: on ? t.ink : pressed ? t.sunken : "transparent" }]}
    >
      <Text style={{ color: on ? t.bg : danger ? t.bad : t.ink, fontSize: strong ? 16 : 13, fontWeight: strong || on ? "700" : "500" }}>{label}</Text>
    </Pressable>
  );
}

const css = StyleSheet.create({
  wrap: { position: "absolute", left: 0, right: 0, bottom: 20, alignItems: "center", zIndex: 25 },
  bar: { flexDirection: "row", alignItems: "center", gap: 2, borderRadius: radius.xl, paddingHorizontal: 8, paddingVertical: 6, maxWidth: "96%", flexWrap: "wrap", justifyContent: "center" },
  small: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  track: { width: 180, height: 32, justifyContent: "center", marginHorizontal: 6 },
  rail: { height: 4, borderRadius: 2, overflow: "hidden" },
  fill: { height: 4 },
  time: { minWidth: 92, textAlign: "center", fontVariant: ["tabular-nums"] },
  back: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.25)", padding: 20 },
  list: { borderRadius: radius.xl, minWidth: 320, maxWidth: 460, width: "100%" },
  row: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth },
});
