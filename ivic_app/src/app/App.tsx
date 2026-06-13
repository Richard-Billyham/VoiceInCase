import { useEffect, useMemo, useState } from "react";
import { Bell, Database, Eye, EyeOff, FolderArchive, Moon, Search, Sun } from "lucide-react";
import { routes } from "./routes";
import { ivicService } from "../services/ivicService";
import type { AppData, AppRoute } from "../types/domain";
import logoUrl from "../assets/brand/IVIC_Logo.png";
import { DashboardPage } from "../pages/dashboard/DashboardPage";
import { FormsPage } from "../pages/forms/FormsPage";
import { BatchesPage } from "../pages/batches/BatchesPage";
import { ReconciliationPage } from "../pages/reconciliation/ReconciliationPage";
import { GroupsPage } from "../pages/groups/GroupsPage";
import { SettingsPage } from "../pages/settings/SettingsPage";

export function App() {
  const [activeRoute, setActiveRoute] = useState<AppRoute>("dashboard");
  const [data, setData] = useState<AppData | null>(null);
  const [globalSearch, setGlobalSearch] = useState("");
  const [statusText, setStatusText] = useState("正在载入本地数据...");

  useEffect(() => {
    ivicService
      .loadAppData()
      .then((next) => {
        setData(next);
        setStatusText("本地数据库已就绪");
      })
      .catch((error) => {
        setStatusText(error instanceof Error ? error.message : "本地数据载入失败");
      });
  }, []);

  const searchCount = useMemo(() => {
    if (!data || !globalSearch.trim()) {
      return 0;
    }
    const needle = globalSearch.trim().toLowerCase();
    return data.forms.filter((item) => [item.title, item.invoiceNumber, item.groupName, item.remark].join(" ").toLowerCase().includes(needle)).length;
  }, [data, globalSearch]);

  async function persist(action: Promise<AppData>, message: string) {
    try {
      const next = await action;
      setData(next);
      setStatusText(message);
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : "操作失败");
    }
  }

  function toggleAmountVisibility() {
    if (!data) {
      return;
    }
    persist(ivicService.saveSettings({ ...data.settings, hideAmounts: !data.settings.hideAmounts }), "敏感金额显示设置已更新");
  }

  function toggleTheme() {
    if (!data) {
      return;
    }
    persist(ivicService.saveSettings({ ...data.settings, darkMode: !data.settings.darkMode }), data.settings.darkMode ? "已切换为日间模式" : "已切换为夜间模式");
  }

  if (!data) {
    return (
      <main className="boot-screen">
        <div className="boot-card">
          <div className="brand-mark logo-mark"><img src={logoUrl} alt="" /></div>
          <h1>InVoice InCase</h1>
          <p>{statusText}</p>
        </div>
      </main>
    );
  }

  const pageProps = { data, persist };

  return (
    <div className="app-shell" data-theme={data.settings.darkMode ? "night" : "day"}>
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-mark logo-mark"><img src={logoUrl} alt="" /></div>
          <div>
            <strong>InVoice InCase</strong>
            <span>本地发票工作台</span>
          </div>
        </div>
        <nav className="side-nav" aria-label="主导航">
          {routes.map((route) => {
            const Icon = route.icon;
            return (
              <button
                key={route.id}
                className={route.id === activeRoute ? "nav-item active" : "nav-item"}
                onClick={() => setActiveRoute(route.id)}
                type="button"
              >
                <Icon size={18} />
                <span>{route.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="sidebar-foot">
          <span>SQLite 本地模式</span>
          <strong>{data.groups.filter((group) => group.isActive).length} 个启用分组</strong>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="topbar-title">
            <h1>{routes.find((route) => route.id === activeRoute)?.label}</h1>
          </div>
          <label className="global-search">
            <Search size={17} />
            <input
              value={globalSearch}
              onChange={(event) => setGlobalSearch(event.target.value)}
              placeholder="搜索发票、表单、批次、备注"
            />
          </label>
          <button className="icon-text-button" type="button" onClick={toggleAmountVisibility}>
            {data.settings.hideAmounts ? <Eye size={17} /> : <EyeOff size={17} />}
            <span>{data.settings.hideAmounts ? "显示金额" : "隐藏金额"}</span>
          </button>
          <button className="icon-text-button" type="button" onClick={toggleTheme}>
            {data.settings.darkMode ? <Sun size={17} /> : <Moon size={17} />}
            <span>{data.settings.darkMode ? "日间模式" : "夜间模式"}</span>
          </button>
          <button className="icon-button" type="button" title="提醒开票" aria-label="提醒开票">
            <Bell size={18} />
          </button>
        </header>

        <div className="search-feedback" hidden={!globalSearch.trim()}>
          <Search size={15} />
          <span>全局搜索命中 {searchCount} 条表单记录；进入表单管理可继续筛选和处理。</span>
        </div>

        <main className="page-host">
          {activeRoute === "dashboard" && <DashboardPage {...pageProps} globalSearch={globalSearch} onNavigate={setActiveRoute} />}
          {activeRoute === "forms" && <FormsPage {...pageProps} />}
          {activeRoute === "batches" && <BatchesPage {...pageProps} />}
          {activeRoute === "reconciliation" && <ReconciliationPage {...pageProps} />}
          {activeRoute === "groups" && <GroupsPage {...pageProps} />}
          {activeRoute === "settings" && <SettingsPage {...pageProps} />}
        </main>

        <footer className="status-bar">
          <span>
            <Database size={14} /> {data.settings.databasePath}
          </span>
          <span>
            <FolderArchive size={14} /> {data.settings.attachmentDir}
          </span>
          <strong>{statusText}</strong>
        </footer>
      </section>
    </div>
  );
}
