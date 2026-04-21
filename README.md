# COTAutoClean

SillyTavern extension that automatically strips leftover chain-of-thought (thinking) blocks from AI messages.

## Problem

SillyTavern's built-in reasoning parser only handles the first `<think>` block at the start of a message. If the model outputs additional thinking blocks later in its response, they leak into the visible text as raw tags.

## What This Does

- Hooks into `MESSAGE_RECEIVED` (fires when a message finishes streaming)
- Scans for any `<think>...</think>` blocks remaining in the message
- Strips them, updates the display, and saves the chat
- Also catches unclosed `<think>` blocks (model got cut off mid-thought)
- Only processes AI responses, never touches user messages

## Install

### Option A: From URL

1. Open SillyTavern
2. Go to Extensions panel > "Install Extension"
3. Paste this URL:
```
https://github.com/IkarusV/COTAutoClean
```
4. Click Install, then reload

### Option B: Manual

1. Clone or download this repo into:
```
SillyTavern/public/scripts/extensions/third-party/COTAutoClean
```
2. Reload SillyTavern

## Settings

Found under the Extensions settings panel ("COT Auto Clean" drawer):

- **Enable auto-cleaning** - Toggle the extension on/off
- **Log removals to console** - See what's being stripped in browser console (F12)
- **Opening tag / Closing tag** - Change the thinking tags if your model uses something different (e.g. `<thinking>` / `</thinking>`). Defaults to `<think>` / `</think>`
- **Scan & Clean All** - Manually scan and clean every message in the current chat

## License

MIT
