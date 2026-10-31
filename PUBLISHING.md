# 게시 절차 (GitHub 공개 → VS Code Marketplace)

이 저장소에는 게시 직전 상태까지 준비돼 있습니다.
- VSIX: `dist/jaewon-claude-status-0.1.0.vsix` (`npm run package`로 다시 만들 수 있음)
- 로고 128×128 투명 PNG: `images/icon.png`
- 캡처: `images/*.png`
- README 4개 국어: `README.md`(영어, Marketplace 기본), `README.ko.md`, `README.ja.md`, `README.zh-CN.md`

**순서가 중요합니다.** Marketplace 상세 페이지의 README 이미지는 `vsce`가 GitHub 주소(`https://github.com/david365-lee/jaewon-claude-status/raw/HEAD/images/...`)로 바꿔 넣습니다. 그래서 **GitHub 공개 저장소에 먼저 push한 뒤** 게시해야 이미지가 보입니다.

## 1. GitHub 공개 저장소

```powershell
winget install --id GitHub.cli        # gh CLI가 없을 때
gh auth login                         # 브라우저 로그인
cd D:\소스코드\jaewon-claude-status
gh repo create david365-lee/jaewon-claude-status --public --source . --remote origin --push `
  --description "Claude Code context-window and token usage in the VS Code status bar (unofficial)"
```

gh 없이 진행하려면 github.com에서 `jaewon-claude-status` 공개 저장소를 빈 상태로 만든 뒤 아래를 실행합니다.

```powershell
git remote add origin https://github.com/david365-lee/jaewon-claude-status.git
git push -u origin main
```

## 2. Marketplace publisher와 토큰

1. https://marketplace.visualstudio.com/manage 에 Microsoft 계정으로 로그인합니다.
2. 기존 publisher `jaewon-lee`(이 PC에 설치된 다른 jaewon-lee 확장과 같은 ID)를 사용합니다. 다른 publisher로 올리려면 `package.json`의 `"publisher"` 값을 그 ID로 바꾸고 `npm run package`를 다시 실행합니다.
3. https://dev.azure.com 에서 Personal Access Token을 발급합니다. Organization은 **All accessible organizations**, Scopes는 **Marketplace › Manage**로 지정합니다. 토큰은 저장소나 파일에 남기지 마세요.

## 3. 게시

```powershell
cd D:\소스코드\jaewon-claude-status
npx --yes @vscode/vsce@3 login jaewon-lee      # 토큰 입력
npx --yes @vscode/vsce@3 publish           # 또는: 관리 페이지에서 dist\*.vsix 업로드
```

게시 후 몇 분 안에 `https://marketplace.visualstudio.com/items?itemName=jaewon-lee.jaewon-claude-status`에서 확인할 수 있습니다.

## 참고: 이름

표시 이름에 "Claude"가 들어 있어 Marketplace 심사에서 상표 문제로 수정을 요청받을 수 있습니다. 그 경우 `package.json`의 `displayName`에 `(Unofficial)`을 붙이거나 이름을 바꾸면 됩니다. README 첫머리에는 Anthropic과 무관한 비공식 확장이라는 안내를 이미 넣어 두었습니다.

## 다음 버전

`package.json`의 `version`을 올리고 `CHANGELOG.md`에 변경 내용을 추가한 뒤 `npx --yes @vscode/vsce@3 publish`를 실행합니다.
