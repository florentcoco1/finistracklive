import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SiteHeader } from "@/components/SiteHeader";
import Index from "./pages/Index.tsx";
import NotFound from "./pages/NotFound.tsx";
import AuthPage from "./pages/AuthPage.tsx";
import RacesList from "./pages/RacesList.tsx";
import RaceDetail from "./pages/RaceDetail.tsx";
import Dashboard from "./pages/Dashboard.tsx";
import NewRace from "./pages/NewRace.tsx";
import TrackerPage from "./pages/TrackerPage.tsx";
import RaceAdmin from "./pages/RaceAdmin.tsx";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <SiteHeader />
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/auth" element={<AuthPage />} />
          <Route path="/races" element={<RacesList />} />
          <Route path="/races/:id" element={<RaceDetail />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/organizer/new-race" element={<NewRace />} />
          <Route path="/organizer/races/:id/admin" element={<RaceAdmin />} />
          <Route path="/race/:id/track" element={<TrackerPage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
