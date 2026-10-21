import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Shell from './v2/Shell';
import Placeholder from './v2/pages/Placeholder';
const LegacyApp = lazy(()=>import('./LegacyApp'));
const queryClient=new QueryClient({defaultOptions:{queries:{retry:1,refetchOnWindowFocus:false}}});
export default function App(){return <QueryClientProvider client={queryClient}><BrowserRouter><Suspense fallback={<div className="page">Loading workspace…</div>}><Routes><Route path="/legacy/*" element={<><div className="legacy-banner"><Link to="/">Return to Vantage V2</Link> · V1 StudioNet archive</div><LegacyApp/></>}/><Route element={<Shell/>}><Route index element={<Placeholder title="A clearer view of what happens next."/>}/><Route path="create" element={<Placeholder title="Design a better question"/>}/><Route path="markets/:id" element={<Placeholder title="Market workspace"/>}/><Route path="scenarios" element={<Placeholder title="Explore the possibilities"/>}/><Route path="precedents" element={<Placeholder title="Every ruling leaves a record"/>}/><Route path="portfolio" element={<Placeholder title="Your vantage point"/>}/><Route path="charter" element={<Placeholder title="The rules, before the trade"/>}/><Route path="*" element={<Placeholder title="Page not found"/>}/></Route></Routes></Suspense></BrowserRouter></QueryClientProvider>;}
