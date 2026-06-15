"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

type WorkspaceV2PreviewErrorBoundaryProps = {
  children: ReactNode;
};

type WorkspaceV2PreviewErrorBoundaryState = {
  componentStack: string | null;
  errorMessage: string | null;
  errorStack: string | null;
};

export class WorkspaceV2PreviewErrorBoundary extends Component<
  WorkspaceV2PreviewErrorBoundaryProps,
  WorkspaceV2PreviewErrorBoundaryState
> {
  state: WorkspaceV2PreviewErrorBoundaryState = {
    componentStack: null,
    errorMessage: null,
    errorStack: null,
  };

  static getDerivedStateFromError(error: unknown) {
    return {
      componentStack: null,
      errorMessage: error instanceof Error ? error.message : String(error),
      errorStack: error instanceof Error ? error.stack ?? null : null,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({
      componentStack: errorInfo.componentStack ?? null,
      errorMessage: error.message,
      errorStack: error.stack ?? null,
    });
  }

  render() {
    if (!this.state.errorMessage) return this.props.children;

    return (
      <section className="workspace-v2-error-boundary" role="alert">
        <span className="eyebrow">Workspace V2 Preview Error</span>
        <h2>Application error captured</h2>
        <p>
          The preview boundary caught the exception, so the screen can stay
          readable for diagnosis.
        </p>
        <dl>
          <div>
            <dt>Error</dt>
            <dd>{this.state.errorMessage}</dd>
          </div>
          {this.state.errorStack && (
            <div>
              <dt>Stack</dt>
              <dd>
                <pre>{this.state.errorStack}</pre>
              </dd>
            </div>
          )}
          {this.state.componentStack && (
            <div>
              <dt>Component stack</dt>
              <dd>
                <pre>{this.state.componentStack}</pre>
              </dd>
            </div>
          )}
        </dl>
      </section>
    );
  }
}
