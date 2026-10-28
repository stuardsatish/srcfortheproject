import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "https://hexosjsftzdqmwqbeahy.supabase.co";
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhleG9zanNmdHpkcW13cWJlYWh5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYwNjkwNjUsImV4cCI6MjEwMTY0NTA2NX0.snKMNLSxXbq8zUkFaZlkrDYz0TsvF6_DY-OsGFmSuvI";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);