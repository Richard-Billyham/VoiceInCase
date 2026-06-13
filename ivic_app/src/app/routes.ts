import {
  BarChart3,
  FileStack,
  Folders,
  Home,
  ReceiptText,
  Settings,
  WalletCards,
} from "lucide-react";
import type { AppRoute } from "../types/domain";

export const routes: Array<{ id: AppRoute; label: string; icon: typeof Home }> = [
  { id: "dashboard", label: "首页/总览", icon: Home },
  { id: "forms", label: "表单管理", icon: ReceiptText },
  { id: "batches", label: "提交批次", icon: FileStack },
  { id: "reconciliation", label: "对账表", icon: WalletCards },
  { id: "groups", label: "分组管理", icon: Folders },
  { id: "settings", label: "设置", icon: Settings },
];

export const secondaryRouteIcon = BarChart3;
