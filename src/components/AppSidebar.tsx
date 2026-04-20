import { LayoutDashboard, Radar, Layers, Briefcase, BellRing, Brain, Settings as SettingsIcon, GripVertical, RotateCcw, Globe, Activity, Compass, LineChart, Zap } from "lucide-react";
import { NavLink } from "@/components/NavLink";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { useEffect, useState } from "react";
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { reconcileOrder } from "@/components/SortableList";
import { Hint } from "@/components/Hint";

const items = [
  { id: "dashboard", title: "Dashboard", url: "/", icon: LayoutDashboard },
  { id: "market", title: "Market", url: "/market", icon: Globe },
  { id: "scanner", title: "Market Scanner", url: "/scanner", icon: Radar },
  { id: "patterns", title: "Patterns", url: "/patterns", icon: Activity },
  { id: "planning", title: "Planning", url: "/planning", icon: Brain },
  { id: "strategy", title: "Strategy Builder", url: "/strategy", icon: Compass },
  { id: "chains", title: "Chains", url: "/chains", icon: Layers },
  { id: "portfolio", title: "Portfolio", url: "/portfolio", icon: Briefcase },
  { id: "alerts", title: "Alerts", url: "/alerts", icon: BellRing },
  { id: "performance", title: "Performance", url: "/performance", icon: LineChart },
  { id: "picks", title: "Picks", url: "/picks", icon: Zap },
  { id: "settings", title: "Settings", url: "/settings", icon: SettingsIcon },
];

const STORAGE_KEY = "nova_sidebar_order";

function readOrder(): string[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as string[]) : null;
  } catch {
    return null;
  }
}

function SortableNavItem({
  item,
  collapsed,
}: {
  item: typeof items[number];
  collapsed: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  // On mobile the sidebar opens as a Sheet overlay — auto-close it after the
  // user picks a workspace so the page underneath becomes interactive again.
  const { isMobile, setOpenMobile } = useSidebar();
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  return (
    <SidebarMenuItem ref={setNodeRef as never} style={style}>
      <div className="group relative flex items-center">
        {!collapsed && (
          <button
            type="button"
            {...attributes}
            {...listeners}
            aria-label="Drag to reorder"
            className="touch-none cursor-grab active:cursor-grabbing absolute left-0 z-10 opacity-0 group-hover:opacity-100 transition-opacity p-1 text-muted-foreground/60 hover:text-foreground"
          >
            <GripVertical className="h-3.5 w-3.5" />
          </button>
        )}
        <SidebarMenuButton asChild className={!collapsed ? "group-hover:pl-6 transition-[padding]" : ""}>
          <NavLink
            to={item.url}
            end={item.url === "/"}
            onClick={() => { if (isMobile) setOpenMobile(false); }}
            className="hover:bg-sidebar-accent/60 transition-colors"
            activeClassName="bg-sidebar-accent text-foreground font-medium border-l-2 border-primary"
          >
            <item.icon className="h-4 w-4" />
            {!collapsed && <span>{item.title}</span>}
          </NavLink>
        </SidebarMenuButton>
      </div>
    </SidebarMenuItem>
  );
}

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const allIds = items.map((i) => i.id);
  const [order, setOrder] = useState<string[]>(() => reconcileOrder(readOrder(), allIds));

  useEffect(() => {
    setOrder((prev) => reconcileOrder(prev, allIds));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setOrder((prev) => {
      const oldIndex = prev.indexOf(String(active.id));
      const newIndex = prev.indexOf(String(over.id));
      if (oldIndex < 0 || newIndex < 0) return prev;
      const next = arrayMove(prev, oldIndex, newIndex);
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  };

  const reset = () => {
    setOrder(allIds);
    window.localStorage.removeItem(STORAGE_KEY);
  };

  const byId = new Map(items.map((i) => [i.id, i]));
  const ordered = order.map((id) => byId.get(id)).filter(Boolean) as typeof items;

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border">
      <SidebarContent className="bg-sidebar">
        <div className="px-4 py-5 flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-gradient-primary shadow-primary-glow flex items-center justify-center font-mono font-bold text-primary-foreground">
            N
          </div>
          {!collapsed && (
            <div className="leading-tight">
              <div className="text-sm font-semibold tracking-wide">NOVA</div>
              <div className="text-[10px] text-muted-foreground tracking-[0.2em]">MARKET TERMINAL</div>
            </div>
          )}
        </div>
        <SidebarGroup>
          <SidebarGroupLabel className="text-[10px] tracking-[0.18em] text-muted-foreground/70 flex items-center justify-between pr-2">
            <span>WORKSPACES</span>
            {!collapsed && (
              <Hint label="Reset workspaces to default order" side="right">
                <button
                  onClick={reset}
                  aria-label="Reset to default order"
                  className="opacity-0 group-hover/sidebar:opacity-100 hover:opacity-100 hover:text-foreground transition-opacity"
                >
                  <RotateCcw className="h-3 w-3" />
                </button>
              </Hint>
            )}
          </SidebarGroupLabel>
          <SidebarGroupContent className="group/sidebar">
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext items={order} strategy={verticalListSortingStrategy}>
                <SidebarMenu>
                  {ordered.map((item) => (
                    <SortableNavItem key={item.id} item={item} collapsed={collapsed} />
                  ))}
                </SidebarMenu>
              </SortableContext>
            </DndContext>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
