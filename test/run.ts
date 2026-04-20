import * as readline from 'readline';
import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

function expandHome(filePath: string): string {
  if (filePath.startsWith('~/') || filePath === '~') {
    return path.join(os.homedir(), filePath.slice(1));
  }
  return filePath;
}

function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim());
    });
  });
}

async function main() {
  console.log('🧪 PGYer CLI Test Runner\n');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  // Collect all lines from stdin upfront if piped
  let apiKey: string;
  let appFilePath: string;

  if (!process.stdin.isTTY) {
    // Non-interactive: read lines from pipe
    const lines = await new Promise<string[]>((resolve) => {
      const collected: string[] = [];
      rl.on('line', (line) => collected.push(line));
      rl.on('close', () => resolve(collected));
    });
    apiKey = (lines[0] || '').trim();
    appFilePath = (lines[1] || '').trim();
  } else {
    // Interactive mode
    apiKey = await ask(rl, '请输入 PGYER_API_KEY（按回车跳过，跳过后需要登录的测试将自动忽略）: ');
    appFilePath = await ask(rl, '请输入测试用 APP 文件路径（.apk/.ipa/.hap，按回车跳过）: ');
    rl.close();
  }

  // Expand ~ in file path
  if (appFilePath) {
    appFilePath = expandHome(appFilePath);
  }

  // Validate app file path if provided
  if (appFilePath && !fs.existsSync(appFilePath)) {
    console.error(`\n❌ 文件不存在: ${appFilePath}`);
    process.exit(1);
  }

  // Build environment variables
  const env: Record<string, string> = { ...process.env as Record<string, string> };

  if (apiKey) {
    env.PGYER_API_KEY = apiKey;
    console.log('\n✅ API Key 已设置');
  } else {
    // Explicitly clear to avoid inheriting from parent env
    delete env.PGYER_API_KEY;
    console.log('\n⏭️  跳过 API Key，需要登录的测试将自动跳过');
  }

  if (appFilePath) {
    env.TEST_APK_PATH = path.resolve(appFilePath);
    console.log(`✅ 测试文件: ${env.TEST_APK_PATH}`);
  } else {
    console.log('⏭️  跳过测试文件，上传相关测试将自动跳过');
  }

  console.log('\n' + '─'.repeat(50));
  console.log('开始运行测试...\n');

  // Spawn test runner
  const child = spawn(
    'node',
    ['--test', '--import', 'tsx', 'test/**/*.test.ts'],
    {
      cwd: path.resolve(__dirname, '..'),
      env,
      stdio: 'inherit',
      shell: true,
    }
  );

  child.on('close', (code) => {
    process.exit(code ?? 0);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
