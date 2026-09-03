# Demo recording for the README. Render with `vhs assets/demo.tape` from the repo root
# (brew install vhs). Runs against the anonymized fixtures through a throwaway $HOME,
# so the output looks like a real run but shows no real data.
Output assets/demo.gif

Set Shell "zsh"
Set FontSize 15
Set FontFamily "Menlo"
Set Width 1180
Set Height 560
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 70ms

Hide
Type `export REPO=$PWD HOME=$(mktemp -d); ln -s $REPO/test/fixtures/claude $HOME/.claude; cp -R $REPO/test/fixtures/codex $HOME/.codex; rm -rf $HOME/.codex/sessions/2026/08/27 $HOME/.codex/sessions/2026/08/31; npx() { shift; node $REPO/dist/cli.js "$@" 2> >(grep -v '^warning' >&2); }; clear`
Enter
Sleep 500ms
Show

Type "npx vibetax"
Sleep 700ms
Enter
Sleep 5s
