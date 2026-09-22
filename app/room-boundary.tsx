"use client";

import { Component, type ReactNode } from "react";
import { errorMessage } from "./error-message";

type Props = {
  children: ReactNode;
  credential: string;
  onExit: () => void;
};

type State = { error: unknown; credential: string };

export class RoomBoundary extends Component<Props, State> {
  override state: State = { error: null, credential: this.props.credential };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  static getDerivedStateFromProps(props: Props, state: State) {
    return props.credential !== state.credential
      ? { credential: props.credential, error: null }
      : null;
  }

  override render() {
    if (this.state.error !== null) {
      return (
        <section className="panel status-panel">
          <p className="eyebrow">Hold that thought</p>
          <h2>We could not open this room.</h2>
          <p role="alert">{errorMessage(this.state.error)}</p>
          <div className="button-row">
            <button type="button" onClick={() => this.setState({ error: null })}>
              Retry room
            </button>
            <button type="button" className="secondary" onClick={this.props.onExit}>
              Return to lobby
            </button>
          </div>
        </section>
      );
    }
    return this.props.children;
  }
}