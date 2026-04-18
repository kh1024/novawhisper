import { Outlet } from "react-router-dom";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { MarketHeader } from "@/components/MarketHeader";
import { TickerTape } from "@/components/TickerTape";
import { NewsTicker } from "@/components/NewsTicker";
import { NovaChatBubble } from "@/components/NovaChatBubble";

export default function AppLayout() {
  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <TickerTape />
          <NewsTicker />
          <MarketHeader />
          <main className="flex-1 overflow-auto">
            <Outlet />
          </main>
        </div>
        <NovaChatBubble />
      </div>
    </SidebarProvider>
  );
}
