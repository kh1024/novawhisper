import { LayoutDashboard, Radar, Microscope, Layers, Briefcase, BookText, BellRing, Settings as SettingsIcon } from "lucide-react";
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

const items = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "Market Scanner", url: "/scanner", icon: Radar },
  { title: "Research", url: "/research", icon: Microscope },
  { title: "Chains", url: "/chains", icon: Layers },
  { title: "Portfolio", url: "/portfolio", icon: Briefcase },
  { title: "Journal", url: "/journal", icon: BookText },
  { title: "Alerts", url: "/alerts", icon: BellRing },
  { title: "Settings", url: "/settings", icon: SettingsIcon },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";

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
          <SidebarGroupLabel className="text-[10px] tracking-[0.18em] text-muted-foreground/70">
            WORKSPACES
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to={item.url}
                      end={item.url === "/"}
                      className="hover:bg-sidebar-accent/60 transition-colors"
                      activeClassName="bg-sidebar-accent text-foreground font-medium border-l-2 border-primary"
                    >
                      <item.icon className="h-4 w-4" />
                      {!collapsed && <span>{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
