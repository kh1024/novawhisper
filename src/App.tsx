import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import AppLayout from "./layouts/AppLayout";
import Dashboard from "./pages/Dashboard";
import Scanner from "./pages/Scanner";
import Research from "./pages/Research";
import Chains from "./pages/Chains";
import Portfolio from "./pages/Portfolio";
import Journal from "./pages/Journal";
import Alerts from "./pages/Alerts";
import Planning from "./pages/Planning";
import Patterns from "./pages/Patterns";
import Market from "./pages/Market";
import Settings from "./pages/Settings";
import Strategy from "./pages/Strategy";
import NotFound from "./pages/NotFound.tsx";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/market" element={<Market />} />
            <Route path="/scanner" element={<Scanner />} />
            <Route path="/patterns" element={<Patterns />} />
            <Route path="/research" element={<Research />} />
            <Route path="/chains" element={<Chains />} />
            <Route path="/portfolio" element={<Portfolio />} />
            <Route path="/journal" element={<Journal />} />
            <Route path="/alerts" element={<Alerts />} />
            <Route path="/planning" element={<Planning />} />
            <Route path="/settings" element={<Settings />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
