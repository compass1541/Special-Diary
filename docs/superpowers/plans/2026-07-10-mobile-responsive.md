# Mobile Responsive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every primary mobile action reachable and keep editing and overlays usable on 320–430px portrait screens.

**Architecture:** Keep the desktop split layout unchanged. In the existing mobile media query, make the list-state sidebar the sole vertical scroll container and replace mobile height constraints with dynamic viewport units plus safe-area padding. Add a stylesheet-level regression test for the responsive contract, then use browser measurements to validate the rendered layout.

**Tech Stack:** Vanilla CSS, Vite, Vitest, ESLint, in-app browser responsive viewport testing.

---

## File structure

- Create: `src/styles.test.js` — guards the mobile stylesheet contract that prevents the inaccessible-bottom-actions regression.
- Modify: `src/styles.css` — contains the responsive layout, safe-area, modal, and touch-target rules.

### Task 1: Lock down the mobile scrolling contract

**Files:**
- Create: `src/styles.test.js`
- Test: `src/styles.test.js`

- [ ] **Step 1: Write the failing stylesheet regression test**

Create `src/styles.test.js` with the following content. It describes the expected mobile contract before changing the stylesheet.

```js
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const stylesPath = fileURLToPath(new URL('./styles.css', import.meta.url));
const styles = readFileSync(stylesPath, 'utf8');
const mobileStyles = styles.slice(styles.indexOf('@media (max-width: 768px)'));

describe('mobile responsive layout', () => {
    it('uses a dynamic viewport and makes the list sidebar scrollable', () => {
        expect(mobileStyles).toContain('height: 100dvh;');
        expect(mobileStyles).toMatch(
            /\.app-container:not\(\.editor-active\) \.sidebar\s*\{[^}]*overflow-y: auto;/s
        );
        expect(mobileStyles).toMatch(
            /\.entries-section\s*\{[^}]*overflow: visible;/s
        );
    });

    it('reserves safe-area space for mobile editing and modal content', () => {
        expect(mobileStyles).toContain('env(safe-area-inset-bottom)');
        expect(mobileStyles).toMatch(
            /\.modal-overlay\s*\{[^}]*height: 100dvh;/s
        );
    });
});
```

- [ ] **Step 2: Run the focused test and verify that it fails**

Run:

```powershell
npx vitest run src/styles.test.js
```

Expected: FAIL because the current mobile rules use `100vh`, hide sidebar overflow, and leave `.entries-section` scrollable.

- [ ] **Step 3: Commit the failing test only**

```powershell
git add src/styles.test.js
git commit -m "test: cover mobile scrolling contract"
```

### Task 2: Implement the responsive mobile layout

**Files:**
- Modify: `src/styles.css:945-1068`
- Test: `src/styles.test.js`

- [ ] **Step 1: Replace the mobile viewport and list rules with dynamic-height, single-scroll rules**

Inside the existing `@media (max-width: 768px)` block, replace the affected list and editor rules with the following declarations. Keep the existing non-mobile rules unchanged.

```css
.app-container {
    flex-direction: column;
    height: 100vh;
    height: 100dvh;
    min-height: 100svh;
    overflow: hidden;
}

.app-container.editor-active .main-content,
.main-content,
.editor-container,
.editor {
    height: 100vh;
    height: 100dvh;
    min-height: 0;
}

.app-container:not(.editor-active) .sidebar {
    display: flex;
    width: 100%;
    height: 100vh;
    height: 100dvh;
    min-height: 100svh;
    max-height: none;
    overflow-y: auto;
    overscroll-behavior-y: contain;
    padding-bottom: max(var(--spacing-md), env(safe-area-inset-bottom));
    border-right: none;
}

.entries-section {
    display: flex;
    flex: 0 0 auto;
    flex-direction: column;
    min-height: 200px;
    overflow: visible;
}
```

- [ ] **Step 2: Add safe-area and touch-target rules at the end of the same mobile media query**

```css
.editor {
    padding-bottom: max(var(--spacing-md), env(safe-area-inset-bottom));
}

.editor-footer {
    padding-bottom: env(safe-area-inset-bottom);
}

.modal-overlay {
    height: 100vh;
    height: 100dvh;
    padding:
        env(safe-area-inset-top)
        var(--spacing-md)
        max(var(--spacing-md), env(safe-area-inset-bottom));
}

.modal {
    max-height: calc(100dvh - var(--spacing-xl));
}

.graph-modal {
    height: calc(100dvh - var(--spacing-xl)) !important;
}

.action-btn,
.calendar-nav,
.modal-close {
    min-width: 44px;
    min-height: 44px;
}
```

- [ ] **Step 3: Run the focused test and verify it passes**

Run:

```powershell
npx vitest run src/styles.test.js
```

Expected: PASS with two passing tests.

- [ ] **Step 4: Run the complete automated suite**

Run:

```powershell
npm test
npm run lint
npm run build
```

Expected: all existing Vitest tests pass, ESLint reports no errors, and Vite produces `dist/` successfully.

- [ ] **Step 5: Commit the implementation**

```powershell
git add src/styles.css src/styles.test.js
git commit -m "fix: improve mobile layout reachability"
```

### Task 3: Verify rendered mobile behavior

**Files:**
- Modify: none
- Test: `src/styles.test.js`

- [ ] **Step 1: Start the local app with a browser-accessible host**

Run:

```powershell
npx vite --host 0.0.0.0
```

Expected: Vite reports a local URL and at least one network URL.

- [ ] **Step 2: Verify each target portrait viewport in the in-app browser**

At 320×568, 360×800, and 430×932, verify all of the following:

```js
({
    hasHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
    sidebarScrolls: getComputedStyle(document.querySelector('.sidebar')).overflowY === 'auto',
    newEntryReachable: document.querySelector('.new-entry-btn').getBoundingClientRect().bottom,
    backupReachable: document.querySelector('.backup-section').getBoundingClientRect().bottom,
});
```

Expected: `hasHorizontalOverflow` is `false`; `sidebarScrolls` is `true`; scrolling the sidebar brings both bottom values within the viewport.

- [ ] **Step 3: Verify the editor and graph overlay at 360×800**

Open a new entry, then open the graph. Confirm the editor footer is visible before the keyboard opens, and that the graph canvas plus side panel remain inside the modal.

Expected: no clipped primary controls, no console errors, and no loss of existing editor or graph interactions.

- [ ] **Step 4: Record the verification result in the handoff**

Report the three tested viewport sizes, whether horizontal overflow occurred, and that the bottom actions, editor footer, and graph overlay were accessible. Do not create a code commit for this reporting-only step.

## Plan self-review

- Spec coverage: Task 2 covers dynamic viewport sizing, a single list scroll path, safe-area spacing, modal sizing, and touch targets. Task 3 covers all required target viewports and the editor/graph checks.
- Placeholder scan: the plan contains concrete file paths, code, commands, and expected outcomes; it has no deferred implementation placeholders.
- Type consistency: no application API or data-model changes are introduced; all selectors referenced by tests and browser checks exist in `src/styles.css` or `index.html`.

