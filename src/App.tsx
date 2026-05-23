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
import EventsList from "./pages/EventsList.tsx";
import EventDetail from "./pages/EventDetail.tsx";
import EventFormPage from "./pages/EventForm.tsx";
import AdminPage from "./pages/Admin.tsx";
import Results from "./pages/Results.tsx";
import LiveMonitor from "./pages/LiveMonitor.tsx";
import CheckpointPhotos from "./pages/CheckpointPhotos.tsx";

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
          <Route path="/events" element={<EventsList />} />
          <Route path="/events/:id" element={<EventDetail />} />
          <Route path="/organizer/new-event" element={<EventFormPage mode="create" />} />
          <Route path="/organizer/events/:id/edit" element={<EventFormPage mode="edit" />} />
          <Route path="/races" element={<RacesList />} />
          <Route path="/races/:id" element={<RaceDetail />} />
          <Route path="/results" element={<Results />} />
          <Route path="/organizer/live" element={<LiveMonitor />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/organizer/new-race" element={<NewRace />} />
          <Route path="/organizer/races/:id/admin" element={<RaceAdmin />} />
          <Route path="/organizer/races/:id/photos" element={<CheckpointPhotos />} />
          <Route path="/race/:id/track" element={<TrackerPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
