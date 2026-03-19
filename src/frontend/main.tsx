import React from 'react';
import ReactDOM from 'react-dom/client';
import Dashboard from './Dashboard';
import ReasoningView from './ReasoningView';

const Router = () => {
    const path = window.location.pathname;
    const params = new URLSearchParams(window.location.search);
    const persistedActive = window.localStorage.getItem('cerebro_active_project') || '';
    const projectSlug = params.get('project') || persistedActive;

    if (path === '/reasoning') {
        return <ReasoningView activeSlug={projectSlug} onBack={() => window.close()} />;
    }

    return <Dashboard />;
};

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <Router />
    </React.StrictMode>
);
