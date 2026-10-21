import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Shell from './v2/Shell';
import Placeholder from './v2/pages/Placeholder';
const Create = lazy(()=>import('./v2/pages/Create'));
const MarketDetail = lazy(()=>import('./v2/pages/MarketDetail'));
const Portfolio = lazy(()=>import('./v2/pages/Portfolio'));
const Discover = lazy(()=>import('./v2/pages/Discover'));
const Library = lazy(()=>import('./v2/pages/Library'));
const Charter = lazy(()=>import('./v2/pages/Charter'));
const Scenarios = lazy(()=>import('./v2/pages/Scenarios'));
const LegacyApp = lazy(()=>import('./LegacyApp'));
const queryClient=new QueryClient({defaultOptions:{queries:{retry:1,refetchOnWindowFocus:false}}});
export default function App(){return <QueryClientProvider client={queryClient}><BrowserRouter><Suspense fallback={<div className="page">Loading workspace…</div>}><Routes><Route path="/legacy/*" element={<><div className="legacy-banner"><Link to="/">Return to Vantage V2</Link> · V1 StudioNet archive</div><LegacyApp/></>}/><Route element={<Shell/>}><Route index element={<Discover/>}/><Route path="create" element={<Create/>}/><Route path="markets/:id" element={<MarketDetail/>}/><Route path="scenarios" element={<Scenarios/>}/><Route path="precedents" element={<Library/>}/><Route path="portfolio" element={<Portfolio/>}/><Route path="charter" element={<Charter/>}/><Route path="*" element={<Placeholder title="Page not found"/>}/></Route></Routes></Suspense></BrowserRouter></QueryClientProvider>;}
