import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { lazy, Suspense } from "react";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import AppLayout from "./layouts/AppLayout";

// Lazy-load route pages so each chunk parses on demand instead of all up
// front. Cuts the longest main-thread task during initial load (lower FID).
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Scanner = lazy(() => import("./pages/Scanner"));
const Chains = lazy(() => import("./pages/Chains"));
const Portfolio = lazy(() => import("./pages/Portfolio"));
const Alerts = lazy(() => import("./pages/Alerts"));
const Planning = lazy(() => import("./pages/Planning"));
const Patterns = lazy(() => import("./pages/Patterns"));
const Market = lazy(() => import("./pages/Market"));
const Settings = lazy(() => import("./pages/Settings"));
const Strategy = lazy(() => import("./pages/Strategy"));
const Landing = lazy(() => import("./pages/Landing"));
const NotFound = lazy(() => import("./pages/NotFound.tsx"));

const queryClient = new QueryClient();

const RouteFallback = () => (
  <div className="flex items-center justify-center p-8 text-xs text-muted-foreground">
    Loading…
  </div>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/landing" element={<Landing />} />
            <Route element={<AppLayout />}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/market" element={<Market />} />
              <Route path="/scanner" element={<Scanner />} />
              <Route path="/patterns" element={<Patterns />} />
              <Route path="/chains" element={<Chains />} />
              <Route path="/portfolio" element={<Portfolio />} />
              <Route path="/alerts" element={<Alerts />} />
              <Route path="/planning" element={<Planning />} />
              <Route path="/strategy" element={<Strategy />} />
              <Route path="/settings" element={<Settings />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
