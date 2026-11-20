// 기기(iOS·Android)용 파일 저장: 앱 문서 폴더 안 (실제 동작은 fileFs.ts, 시험은 fileFs.test.ts)
import { Directory, File, Paths } from "expo-file-system";

import { makeFileFs, type FileApi } from "./fileFs";

export const deviceFs = makeFileFs({ File, Directory, root: Paths.document } as unknown as FileApi);
