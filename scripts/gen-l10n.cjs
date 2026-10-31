// Generates package.nls*.json and l10n bundles from one table so the four languages stay in sync.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

const nls = {
  description: {
    en: 'Shows Claude Code context-window usage and session tokens in the VS Code status bar, read from local Claude Code transcripts.',
    ko: 'Claude Code의 컨텍스트 창 사용률과 세션 토큰을 VS Code 상태 표시줄에 보여 줍니다. 로컬 Claude Code 대화 기록을 읽습니다.',
    ja: 'Claude Code のコンテキストウィンドウ使用率とセッションのトークン数を VS Code のステータスバーに表示します。ローカルの Claude Code の会話記録を読み取ります。',
    'zh-cn': '在 VS Code 状态栏显示 Claude Code 的上下文窗口使用率和会话 token 数，数据来自本地 Claude Code 对话记录。',
  },
  'command.showDetails': { en: 'Show usage details', ko: '사용량 자세히 보기', ja: '使用量の詳細を表示', 'zh-cn': '显示用量详情' },
  'command.refresh': { en: 'Refresh usage', ko: '사용량 새로고침', ja: '使用量を更新', 'zh-cn': '刷新用量' },
  'command.showLog': { en: 'Show log', ko: '로그 보기', ja: 'ログを表示', 'zh-cn': '显示日志' },
  'config.enabled': { en: 'Show Claude Code usage in the status bar.', ko: '상태 표시줄에 Claude Code 사용량을 표시합니다.', ja: 'ステータスバーに Claude Code の使用量を表示します。', 'zh-cn': '在状态栏中显示 Claude Code 用量。' },
  'config.sessionScope': { en: 'Which Claude Code session to follow.', ko: '따라갈 Claude Code 세션입니다.', ja: '追跡する Claude Code セッション。', 'zh-cn': '要跟踪的 Claude Code 会话。' },
  'config.sessionScope.workspace': {
    en: 'The newest session started in an open workspace folder (falls back to the newest overall).',
    ko: '열린 작업 폴더에서 시작한 가장 최근 세션 (없으면 전체에서 가장 최근)',
    ja: '開いているワークスペースフォルダーで開始した最新のセッション (なければ全体で最新)',
    'zh-cn': '在已打开的工作区文件夹中启动的最新会话（没有时使用全部中最新的）',
  },
  'config.sessionScope.latest': { en: 'The newest session of any project.', ko: '모든 프로젝트 중 가장 최근 세션', ja: 'すべてのプロジェクトで最新のセッション', 'zh-cn': '所有项目中最新的会话' },
  'config.statusFormat': {
    en: 'Status bar text. Placeholders: `{percent}` `{context}` `{window}` `{model}` `{session}` `{output}` `{cost}`. Codicons such as `$(pulse)` are allowed.',
    ko: '상태 표시줄 문구입니다. 자리표시자: `{percent}` `{context}` `{window}` `{model}` `{session}` `{output}` `{cost}`. `$(pulse)` 같은 Codicon을 쓸 수 있습니다.',
    ja: 'ステータスバーの表示。プレースホルダー: `{percent}` `{context}` `{window}` `{model}` `{session}` `{output}` `{cost}`。`$(pulse)` などの Codicon も使えます。',
    'zh-cn': '状态栏文本。占位符：`{percent}` `{context}` `{window}` `{model}` `{session}` `{output}` `{cost}`。可以使用 `$(pulse)` 等 Codicon。',
  },
  'config.contextWindow': {
    en: 'Context window size in tokens, or `auto` (1,000,000 for 1M-context models or when usage already exceeds 200,000; otherwise 200,000).',
    ko: '컨텍스트 창 크기(토큰) 또는 `auto`. auto는 1M 컨텍스트 모델이거나 이미 200,000을 넘으면 1,000,000, 그 외에는 200,000으로 봅니다.',
    ja: 'コンテキストウィンドウのサイズ (トークン) または `auto`。auto は 1M コンテキストのモデル、または使用量がすでに 200,000 を超えている場合は 1,000,000、それ以外は 200,000 とみなします。',
    'zh-cn': '上下文窗口大小（token）或 `auto`。auto 在 1M 上下文模型或用量已超过 200,000 时视为 1,000,000，否则为 200,000。',
  },
  'config.warningThreshold': { en: 'Context percentage that turns the item yellow.', ko: '항목을 노란색으로 표시할 컨텍스트 사용률(%)', ja: '項目を黄色にするコンテキスト使用率 (%)', 'zh-cn': '状态项变为黄色的上下文使用率（%）' },
  'config.errorThreshold': { en: 'Context percentage that turns the item red.', ko: '항목을 빨간색으로 표시할 컨텍스트 사용률(%)', ja: '項目を赤にするコンテキスト使用率 (%)', 'zh-cn': '状态项变为红色的上下文使用率（%）' },
  'config.refreshIntervalSeconds': { en: 'How often to check the transcript, in seconds.', ko: '대화 기록을 확인하는 주기(초)', ja: '会話記録を確認する間隔 (秒)', 'zh-cn': '检查对话记录的间隔（秒）' },
  'config.alignment': { en: 'Side of the status bar.', ko: '상태 표시줄에서 표시할 위치', ja: 'ステータスバーの表示位置', 'zh-cn': '状态栏中的位置' },
  'config.pricing': {
    en: 'Optional prices in USD per million tokens, keyed by model-id prefix, e.g. `{ "claude-opus": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 } }`. Empty = no cost is shown. Results are estimates only.',
    ko: '선택 사항. 모델 ID 접두사별 100만 토큰당 USD 단가입니다. 예: `{ "claude-opus": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 } }`. 비워 두면 비용을 표시하지 않습니다. 결과는 추정값입니다.',
    ja: '任意。モデル ID の接頭辞ごとの 100 万トークンあたりの USD 単価。例: `{ "claude-opus": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 } }`。空の場合は費用を表示しません。結果は推定値です。',
    'zh-cn': '可选。按模型 ID 前缀设置每百万 token 的美元单价，例如 `{ "claude-opus": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 } }`。为空时不显示费用。结果仅为估算值。',
  },
};

const ui = {
  'Claude Code usage': { ko: 'Claude Code 사용량', ja: 'Claude Code の使用量', 'zh-cn': 'Claude Code 用量' },
  Model: { ko: '모델', ja: 'モデル', 'zh-cn': '模型' },
  Context: { ko: '컨텍스트', ja: 'コンテキスト', 'zh-cn': '上下文' },
  'window auto-detected': { ko: '창 크기 자동 판단', ja: 'ウィンドウサイズ自動判定', 'zh-cn': '窗口大小自动判断' },
  'Session input': { ko: '세션 입력', ja: 'セッション入力', 'zh-cn': '会话输入' },
  'Session output': { ko: '세션 출력', ja: 'セッション出力', 'zh-cn': '会话输出' },
  'Cache read / write': { ko: '캐시 읽기 / 쓰기', ja: 'キャッシュ読み取り / 書き込み', 'zh-cn': '缓存读取 / 写入' },
  Responses: { ko: '응답 수', ja: '応答数', 'zh-cn': '响应数' },
  'Estimated cost': { ko: '추정 비용', ja: '推定費用', 'zh-cn': '估算费用' },
  'from your pricing settings': { ko: '설정한 단가 기준', ja: '設定した単価に基づく', 'zh-cn': '基于您设置的单价' },
  'Last response': { ko: '마지막 응답', ja: '最後の応答', 'zh-cn': '最近响应' },
  Session: { ko: '세션', ja: 'セッション', 'zh-cn': '会话' },
  'this workspace': { ko: '현재 작업 폴더', ja: 'このワークスペース', 'zh-cn': '当前工作区' },
  'most recent of all projects': { ko: '전체 프로젝트 중 최근', ja: '全プロジェクトで最新', 'zh-cn': '所有项目中最新' },
  Details: { ko: '자세히', ja: '詳細', 'zh-cn': '详情' },
  Log: { ko: '로그', ja: 'ログ', 'zh-cn': '日志' },
  'Claude: no session': { ko: 'Claude: 세션 없음', ja: 'Claude: セッションなし', 'zh-cn': 'Claude：无会话' },
  'No Claude Code transcript with usage was found yet. Start a conversation in Claude Code.': {
    ko: '사용량이 기록된 Claude Code 대화를 아직 찾지 못했습니다. Claude Code에서 대화를 시작하세요.',
    ja: '使用量が記録された Claude Code の会話がまだ見つかりません。Claude Code で会話を始めてください。',
    'zh-cn': '尚未找到记录用量的 Claude Code 对话。请在 Claude Code 中开始对话。',
  },
  'Copy summary': { ko: '요약 복사', ja: '概要をコピー', 'zh-cn': '复制摘要' },
  'Show log': { ko: '로그 보기', ja: 'ログを表示', 'zh-cn': '显示日志' },
  'Open settings': { ko: '설정 열기', ja: '設定を開く', 'zh-cn': '打开设置' },
  'Usage summary copied.': { ko: '사용량 요약을 복사했습니다.', ja: '使用量の概要をコピーしました。', 'zh-cn': '已复制用量摘要。' },
};

const write = (file, data) => fs.writeFileSync(path.join(root, file), JSON.stringify(data, null, 2) + '\n', 'utf8');
for (const lang of ['en', 'ko', 'ja', 'zh-cn']) {
  write(lang === 'en' ? 'package.nls.json' : `package.nls.${lang}.json`, Object.fromEntries(Object.entries(nls).map(([k, v]) => [k, v[lang]])));
}
fs.mkdirSync(path.join(root, 'l10n'), { recursive: true });
for (const lang of ['ko', 'ja', 'zh-cn']) {
  write(`l10n/bundle.l10n.${lang}.json`, Object.fromEntries(Object.entries(ui).map(([k, v]) => [k, v[lang]])));
}
module.exports = { nls, ui };
console.log('l10n files written');
