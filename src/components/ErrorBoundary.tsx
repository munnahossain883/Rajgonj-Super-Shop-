import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      let errorMessage = "দুঃখিত, একটি অপ্রত্যাশিত সমস্যা হয়েছে।";
      let isFirestoreError = false;

      try {
        if (this.state.error?.message) {
          const parsed = JSON.parse(this.state.error.message);
          if (parsed.error && parsed.operationType) {
            isFirestoreError = true;
            errorMessage = `ডাটাবেস সমস্যা: ${parsed.error}`;
          }
        }
      } catch (e) {
        // Not a JSON error message
      }

      return (
        <div className="min-h-screen bg-[#f5f5f0] flex flex-col items-center justify-center p-6 text-center">
          <div className="max-w-md w-full bg-white rounded-[32px] p-10 shadow-sm border border-[#e5e5e0]">
            <div className="w-20 h-20 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-6">
              <AlertCircle className="w-10 h-10" />
            </div>
            <h1 className="text-2xl font-serif font-bold text-[#1a1a1a] mb-4">ওহ না! কিছু ভুল হয়েছে</h1>
            <p className="text-[#5A5A40] mb-8 leading-relaxed">
              {errorMessage}
              {isFirestoreError && (
                <span className="block mt-2 text-xs opacity-70">
                  অনুগ্রহ করে আপনার ইন্টারনেট কানেকশন চেক করুন অথবা কিছুক্ষণ পর আবার চেষ্টা করুন।
                </span>
              )}
            </p>
            <button
              onClick={this.handleReset}
              className="w-full bg-[#5A5A40] text-white py-4 rounded-full font-bold flex items-center justify-center gap-2 hover:bg-[#4a4a35] transition-colors"
            >
              <RefreshCw className="w-5 h-5" />
              আবার চেষ্টা করুন
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
