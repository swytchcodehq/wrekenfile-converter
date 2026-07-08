# VHS tape for wrekenfile-converter's README demo GIF.
#
# Regenerate with:
#   npm ci && npm run build
#   vhs docs/demo.tape
#
# Requires vhs (https://github.com/charmbracelet/vhs) and ttyd on PATH,
# plus Node.js available in whatever shell vhs launches.
# Run from the repo root after building (dist/ must exist).

Output docs/demo.gif

Set Shell "bash"
Set FontSize 17
Set Width 1200
Set Height 650
Set Theme "Github"
Set Padding 20
Set TypingSpeed 30ms

Type "ls demo"
Enter
Sleep 1200ms

Type "head -12 demo/podcastindex-api.json"
Enter
Sleep 1500ms

Type "node dist/v2/cli/cli-openapi-to-wrekenfile.js --input demo/podcastindex-api.json --output demo/wrekenfile-demo-output.yaml"
Enter
Sleep 1500ms

Type "head -16 demo/wrekenfile-demo-output.yaml"
Enter
Sleep 2500ms
