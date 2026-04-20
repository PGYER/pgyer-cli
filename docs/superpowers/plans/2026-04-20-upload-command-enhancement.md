# Upload Command Enhancement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enhance the upload command with password, install date, and channel shortcut options.

**Architecture:** Modify the existing upload command to add new CLI options with validation logic for install type and date range.

**Tech Stack:** TypeScript, cac CLI framework

---

### Task 1: Update CLI Options and Help Text

**Files:**
- Modify: `src/commands/upload/index.ts`

- [ ] **Step 1: Update command options definition**

Replace the existing command registration (lines 18-27) with enhanced options:

```typescript
export function registerUploadCommand(cli: CAC): void {
  cli
    .command('upload <file>', 'Upload an app package (IPA/APK/HAP)')
    .option('--app-key <key>', 'Target app key (optional)')
    .option('--build-update-description <desc>', 'Version update description')
    .option('--build-install-type <type>', 'Install type: 1=public, 2=password, 3=invite (only needed for invite)')
    .option('--password <pwd>', 'Install password (sets install type to password automatically)')
    .option('--pubstart <date>', 'Install validity start date (format: YYYY-MM-DD)')
    .option('--pubend <date>', 'Install validity end date (format: YYYY-MM-DD)')
    .option('--short <shortcut>', 'Channel shortcut')
```

- [ ] **Step 2: Update the action function options type**

Replace the options type definition (lines 29-36):

```typescript
      async (
        file: string,
        options: {
          appKey?: string;
          buildUpdateDescription?: string;
          buildInstallType?: number;
          password?: string;
          pubstart?: string;
          pubend?: string;
          short?: string;
        }
      ) => {
```

---

### Task 2: Add Validation Logic

**Files:**
- Modify: `src/commands/upload/index.ts`

- [ ] **Step 1: Add date validation before file check**

Insert validation logic after `const logger = createLogger();` and before the file existence check:

```typescript
        const logger = createLogger();
        const spinner = createSpinner('Uploading...');

        try {
          // Validate pubstart/pubend
          if ((options.pubstart && !options.pubend) || (!options.pubstart && options.pubend)) {
            logger.error('--pubstart and --pubend must be used together');
            process.exit(1);
          }

          if (options.pubstart && options.pubend) {
            const startDate = new Date(options.pubstart);
            const endDate = new Date(options.pubend);
            
            if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
              logger.error('Invalid date format. Use YYYY-MM-DD format');
              process.exit(1);
            }

            if (endDate <= startDate) {
              logger.error('--pubend must be greater than --pubstart');
              process.exit(1);
            }
          }

          // Validate file exists
          const filePath = path.resolve(file);
```

---

### Task 3: Implement Install Type Logic and Form Data Building

**Files:**
- Modify: `src/commands/upload/index.ts`

- [ ] **Step 1: Replace form data building section**

Replace the form data building section (lines 51-72) with:

```typescript
          // Determine install type
          let buildInstallType = 1; // Default: public
          if (options.buildInstallType === 3) {
            buildInstallType = 3; // Invite
          } else if (options.password) {
            buildInstallType = 2; // Password
          } else if (options.buildInstallType) {
            buildInstallType = options.buildInstallType;
          }

          // Build form data
          const formData = new FormData();
          const fileContent = fs.readFileSync(filePath);
          const fileName = path.basename(filePath);

          const blob = new Blob([fileContent]);
          formData.append('file', blob, fileName);

          if (options.appKey) {
            formData.append('appKey', options.appKey);
          }
          if (options.buildUpdateDescription) {
            formData.append('buildUpdateDescription', options.buildUpdateDescription);
          }
          
          formData.append('buildInstallType', String(buildInstallType));
          
          if (options.password) {
            formData.append('buildPassword', options.password);
          }
          
          if (options.pubstart && options.pubend) {
            formData.append('buildInstallDate', '1');
            formData.append('buildInstallStartDate', options.pubstart);
            formData.append('buildInstallEndDate', options.pubend);
          }
          
          if (options.short) {
            formData.append('buildChannelShortcut', options.short);
          }
```

---

### Task 4: Verify Implementation

**Files:**
- Modify: `src/commands/upload/index.ts`

- [ ] **Step 1: Build and check for TypeScript errors**

Run: `npm run build`
Expected: Build succeeds without errors

- [ ] **Step 2: Verify help output**

Run: `node dist/index.js upload --help`
Expected: Shows all new options with descriptions

- [ ] **Step 3: Test validation logic**

Run: `node dist/index.js upload --pubstart 2026-01-01 test.apk`
Expected: Error message "--pubstart and --pubend must be used together"

Run: `node dist/index.js upload --pubstart 2026-12-31 --pubend 2026-01-01 test.apk`
Expected: Error message "--pubend must be greater than --pubstart"

---

### Task 5: Commit Changes

- [ ] **Step 1: Commit the changes**

```bash
git add doc/spec/modules.md src/commands/upload/index.ts
git commit -m "$(cat <<'EOF'
feat(upload): add password, date range, and channel shortcut options

- Add --password option for password install (auto-sets type=2)
- Add --pubstart/--pubend for install validity period
- Add --short for channel shortcut
- Add validation for date range (must both exist, end > start)
- Update help text with usage instructions

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```
