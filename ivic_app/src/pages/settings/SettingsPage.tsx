import { ArchiveRestore, CheckCircle2, Database, Download, FolderOpen, Info, RefreshCw, Save, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "../../components/ui/Button";
import { ivicService } from "../../services/ivicService";
import type { SettingsPathKind, UpdateCheckResult } from "../../services/ivicService";
import type { AppData, Settings } from "../../types/domain";

interface SettingsPageProps {
  data: AppData;
  persist: (action: Promise<AppData>, message: string) => Promise<void>;
}

const APP_VERSION_LABEL = "v2.1.0-beta";
const APP_VERSION_UPDATED_AT = "2026-06-17";

export function SettingsPage({ data, persist }: SettingsPageProps) {
  const [draft, setDraft] = useState<Settings>(data.settings);
  const [updateChecking, setUpdateChecking] = useState(false);
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(null);

  useEffect(() => {
    setDraft(data.settings);
  }, [data.settings]);

  function updateDraft(patch: Partial<Settings>) {
    setDraft({ ...draft, ...patch });
  }

  async function selectPath(kind: SettingsPathKind) {
    try {
      const value = await ivicService.selectSettingsPath(kind, draft[kind]);
      if (value) {
        updateDraft({ [kind]: value });
      }
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "打开系统路径选择器失败。");
    }
  }

  async function checkUpdates() {
    setUpdateChecking(true);
    try {
      const result = await ivicService.checkForUpdates();
      setUpdateResult(result);
    } catch (error) {
      setUpdateResult({
        hasUpdate: false,
        currentVersion: "未知",
        latestVersion: "未知",
        message: error instanceof Error ? error.message : "检测更新失败，请稍后再试。",
      });
    } finally {
      setUpdateChecking(false);
    }
  }

  function restoreBackup() {
    const backupPath = window.prompt("请输入要恢复的备份文件路径。恢复前请确认已经备份当前数据。");
    if (!backupPath) {
      return;
    }
    const confirmed = window.confirm(`确认恢复备份？\n${backupPath}\n当前版本先记录路径并提示风险，真实覆盖恢复会在 Rust restoreBackup 命令接入后执行。`);
    if (confirmed) {
      persist(ivicService.saveSettings({ ...draft, lastBackupAt: `待恢复：${backupPath}` }), "已记录恢复备份请求");
    }
  }

  async function openDeveloperUrl(url: string) {
    try {
      await ivicService.openExternalUrl(url);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "打开外部链接失败。");
    }
  }

  return (
    <div className="settings-layout">
      <section className="work-panel settings-panel">
        <div className="panel-heading">
          <div>
            <span className="section-kicker">本地文件</span>
            <h3>数据库与附件目录</h3>
          </div>
          <Button icon={<Save size={16} />} variant="primary" onClick={() => persist(ivicService.saveSettings(draft), "设置已保存")}>保存设置</Button>
        </div>
        <div className="settings-list">
          <label className="setting-row">
            <Database size={20} />
            <span>
              <strong>本地数据库文件</strong>
              <small>SQLite 文件路径，恢复前会提示覆盖影响。</small>
            </span>
            <input value={draft.databasePath} onChange={(event) => updateDraft({ databasePath: event.target.value })} />
            <button type="button" aria-label="选择数据库文件" onClick={() => selectPath("databasePath")}><FolderOpen size={17} /></button>
          </label>
          <label className="setting-row">
            <FolderOpen size={20} />
            <span>
              <strong>附件目录</strong>
              <small>发票原件、到账截图和补充材料保存位置。</small>
            </span>
            <input value={draft.attachmentDir} onChange={(event) => updateDraft({ attachmentDir: event.target.value })} />
            <button type="button" aria-label="选择附件目录" onClick={() => selectPath("attachmentDir")}><FolderOpen size={17} /></button>
          </label>
        </div>
      </section>

      <section className="work-panel settings-panel">
        <div className="panel-heading">
          <div>
            <span className="section-kicker">备份恢复</span>
            <h3>本地数据安全</h3>
          </div>
          <ShieldCheck size={22} />
        </div>
        <div className="backup-actions">
          <Button icon={<ArchiveRestore size={16} />} variant="primary" onClick={() => persist(ivicService.backupNow(), "已创建本地备份记录")}>立即备份</Button>
          <Button icon={<ArchiveRestore size={16} />} onClick={restoreBackup}>恢复备份</Button>
          <p>最近备份：{data.settings.lastBackupAt ?? "尚未备份"}</p>
        </div>
      </section>

      <section className="work-panel settings-panel">
        <div className="panel-heading">
          <div>
            <h3>应用信息</h3>
          </div>
          <Info size={22} />
        </div>
        <div className="about-box">
          <strong>InVoice InCase {APP_VERSION_LABEL}</strong>
          <span className="developer-links">
            开发者
            <a
              href="https://github.com/Richard-Billyham"
              onClick={(event) => {
                event.preventDefault();
                void openDeveloperUrl("https://github.com/Richard-Billyham");
              }}
              rel="noreferrer"
              target="_blank"
            >
              Sean
            </a>
            <a
              href="https://github.com/SangLuo123"
              onClick={(event) => {
                event.preventDefault();
                void openDeveloperUrl("https://github.com/SangLuo123");
              }}
              rel="noreferrer"
              target="_blank"
            >
              ChengFu
            </a>
          </span>
          <small>核心功能默认离线运行，不上传发票、附件或数据库。</small>
          <div className="settings-update-row">
            <Button icon={<RefreshCw size={16} />} onClick={checkUpdates} disabled={updateChecking}>
              {updateChecking ? "检测中" : "检测更新"}
            </Button>
            <span className="settings-version-meta">
              <small>当前版本：{APP_VERSION_LABEL}</small>
              <small>最近更新时间：{APP_VERSION_UPDATED_AT}</small>
            </span>
          </div>
        </div>
      </section>
      {updateResult && (
        <div className="modal-backdrop confirm-backdrop" role="presentation">
          <section aria-modal="true" className="modal-card update-check-modal" role="dialog">
            <div className={updateResult.hasUpdate ? "update-check-icon has-update" : "update-check-icon"}>
              {updateResult.hasUpdate ? <Download size={24} /> : <CheckCircle2 size={24} />}
            </div>
            <div className="update-check-copy">
              <span className="section-kicker">检测更新</span>
              <h3>{updateResult.hasUpdate ? "发现新版本" : "已是最新版本"}</h3>
              <p>{updateResult.message}</p>
              <div className="update-version-grid">
                <span>当前版本</span>
                <strong>v{updateResult.currentVersion}</strong>
                <span>最新版本</span>
                <strong>v{updateResult.latestVersion}</strong>
              </div>
            </div>
            <div className="modal-actions">
              <Button onClick={() => setUpdateResult(null)}>关闭</Button>
              {updateResult.hasUpdate && (
                <Button icon={<Download size={16} />} variant="primary" onClick={() => setUpdateResult(null)}>
                  立即更新
                </Button>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
