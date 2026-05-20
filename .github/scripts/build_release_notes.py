from __future__ import annotations

import os
import subprocess
from pathlib import Path


ROOT = Path.cwd()
DIST = ROOT / "dist"


def run_git(args: list[str], *, check: bool = True) -> str:
    result = subprocess.run(
        ["git", *args],
        cwd=ROOT,
        check=False,
        capture_output=True,
        text=True,
    )
    if check and result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or f"git {' '.join(args)} failed")
    return result.stdout.strip()


def current_tag() -> str:
    tag = os.environ.get("GITHUB_REF_NAME", "").strip()
    if tag:
        return tag
    described = run_git(["describe", "--tags", "--exact-match"], check=False)
    return described or "local-build"


def previous_tag() -> str | None:
    described = run_git(["describe", "--tags", "--abbrev=0", "HEAD^"], check=False)
    return described or None


def changed_files(previous: str | None) -> list[str]:
    if previous:
        output = run_git(["diff", "--name-only", f"{previous}..HEAD"], check=False)
    else:
        output = run_git(["ls-tree", "-r", "--name-only", "HEAD"], check=False)
    return [line for line in output.splitlines() if line.strip()]


def commit_subjects(previous: str | None) -> list[str]:
    if previous:
        output = run_git(["log", "--pretty=format:%s", f"{previous}..HEAD"], check=False)
    else:
        output = run_git(["log", "--pretty=format:%s", "-20"], check=False)
    subjects = [line.strip() for line in output.splitlines() if line.strip()]
    return subjects[:30]


def optional_manual_notes(tag: str) -> str:
    candidates = [
        ROOT / ".github" / "release-notes" / f"{tag}.md",
        ROOT / "release-notes" / f"{tag}.md",
    ]
    for path in candidates:
        if path.exists():
            return path.read_text(encoding="utf-8").strip()
    return ""


def categorize(paths: list[str]) -> list[tuple[str, str, list[str]]]:
    groups: list[tuple[str, str, list[str]]] = [
        (
            "Lite판 플러그인",
            "RisuAI에 바로 가져다 넣는 단일 플러그인 파일이 바뀌었습니다.",
            [],
        ),
        (
            "Full판 플러그인",
            "RisuAI 안에서 보이는 Full판 플러그인 화면이나 동작이 바뀌었습니다.",
            [],
        ),
        (
            "Full판 서버",
            "Docker로 실행하는 멀티에이전트 분석 서버가 바뀌었습니다.",
            [],
        ),
        (
            "설치/실행 설정",
            "Docker, 환경변수 예시, Python 의존성 같은 실행 준비물이 바뀌었습니다.",
            [],
        ),
        (
            "문서",
            "README나 사용 설명이 바뀌었습니다.",
            [],
        ),
        (
            "배포 자동화",
            "GitHub/Gitea 릴리즈 자동화나 백업용 workflow가 바뀌었습니다.",
            [],
        ),
        (
            "기타",
            "내부 정리나 분류되지 않은 파일이 바뀌었습니다.",
            [],
        ),
    ]

    def add(index: int, path: str) -> None:
        groups[index][2].append(path)

    for path in paths:
        if path.startswith("lite/"):
            add(0, path)
        elif path.startswith("full/plugin/"):
            add(1, path)
        elif path.startswith("full/app/"):
            add(2, path)
        elif path in {
            "full/Dockerfile",
            "full/docker-compose.yml",
            "full/requirements.txt",
            "full/.env.example",
        }:
            add(3, path)
        elif path.endswith(".md") or path.startswith("docs/"):
            add(4, path)
        elif path.startswith(".github/") or path.startswith(".gitea/"):
            add(5, path)
        else:
            add(6, path)

    return [group for group in groups if group[2]]


def affected_user_lines(groups: list[tuple[str, str, list[str]]], tag: str) -> list[str]:
    group_names = {name for name, _description, _paths in groups}
    lines: list[str] = []

    if "Lite판 플러그인" in group_names:
        lines.append(
            f"- Lite판만 쓰는 경우: `multiagent-lite-{tag}.js` 파일을 받아 RisuAI 플러그인에서 교체하면 됩니다."
        )
    if {"Full판 플러그인", "Full판 서버", "설치/실행 설정"} & group_names:
        lines.append(
            f"- Full판을 쓰는 경우: `multiagent-full-{tag}.zip`을 받아 서버 파일과 플러그인을 함께 업데이트하는 것을 권장합니다."
        )
    if not lines:
        lines.append("- 일반 사용자는 기존 설치를 그대로 유지해도 됩니다. 필요한 경우 아래 파일만 받아 보관하세요.")
    return lines


def build_notes() -> str:
    tag = current_tag()
    previous = previous_tag()
    files = changed_files(previous)
    groups = categorize(files)
    commits = commit_subjects(previous)
    manual = optional_manual_notes(tag)

    lines: list[str] = [
        f"# risu-multiagent {tag}",
        "",
    ]

    if manual:
        lines.extend([
            "## 이번 업데이트 한눈에 보기",
            "",
            manual,
            "",
        ])
    else:
        lines.extend([
            "## 이번 업데이트 한눈에 보기",
            "",
        ])
        if groups:
            for name, description, paths in groups:
                lines.append(f"- **{name}**: {description} ({len(paths)}개 파일)")
        else:
            lines.append("- 자동으로 감지된 파일 변경은 없습니다.")
        lines.append("")

    lines.extend([
        "## 어떤 파일을 받으면 되나요?",
        "",
        f"- `multiagent-lite-{tag}.js`: Lite판 사용자용 단일 플러그인 파일입니다.",
        f"- `multiagent-full-{tag}.zip`: Full판 사용자용 서버 파일과 플러그인 묶음입니다.",
        "",
        "## 누가 업데이트하면 되나요?",
        "",
        *affected_user_lines(groups, tag),
        "",
        "## 업데이트 방법",
        "",
        "1. Lite판을 업데이트하는 경우: `multiagent-lite` 파일을 내려받아 RisuAI의 플러그인 가져오기/교체 기능으로 넣으면 됩니다.",
        "2. Full판을 업데이트하는 경우: `multiagent-full` 압축 파일을 풀고, 기존 `.env` 파일은 보존한 뒤 Docker 컨테이너를 다시 빌드해서 실행하면 됩니다.",
        "3. Full판 플러그인도 함께 바뀌었을 수 있으니, 압축 파일 안의 `plugin` 폴더에 있는 새 플러그인을 RisuAI에 다시 가져오는 것을 권장합니다.",
        "",
        "## 업데이트 전 참고",
        "",
        "- API 키와 개인 설정은 릴리즈 파일에 포함되지 않습니다.",
        "- Full판을 쓰고 있다면 기존 `.env`와 `data/config.json`을 지우지 마세요.",
        "- 문제가 생기면 이전 릴리즈 파일로 되돌릴 수 있게 기존 파일을 잠시 보관해 두는 것이 좋습니다.",
        "",
    ])

    if commits:
        range_label = f"{previous}..{tag}" if previous else f"최근 변경..{tag}"
        lines.extend([
            "## 개발자용 변경 기록",
            "",
            f"범위: `{range_label}`",
            "",
        ])
        for subject in commits:
            lines.append(f"- {subject}")
        lines.append("")

    if files:
        lines.extend([
            "<details>",
            "<summary>변경된 파일 보기</summary>",
            "",
            "```text",
            *files,
            "```",
            "",
            "</details>",
            "",
        ])

    return "\n".join(lines)


def main() -> None:
    DIST.mkdir(parents=True, exist_ok=True)
    (DIST / "release-notes.md").write_text(build_notes(), encoding="utf-8")
    print((DIST / "release-notes.md").as_posix())


if __name__ == "__main__":
    main()
