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
        <section className="screen" aria-labelledby="room-error">
          <h1 className="headline big" id="room-error">
            This room didn’t open.
          </h1>
          <p className="sub" role="alert">
            {errorMessage(this.state.error)}
          </p>
          <div className="actions">
            <button
              className="btn"
              type="button"
              onClick={() => this.setState({ error: null })}
            >
              Try again
            </button>
            <button
              className="btn secondary"
              type="button"
              onClick={this.props.onExit}
            >
              Back to start
            </button>
          </div>
        </section>
      );
    }
    return this.props.children;
  }
}
