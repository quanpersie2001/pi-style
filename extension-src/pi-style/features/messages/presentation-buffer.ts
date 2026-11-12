/** Frame-aligned presentation only: Pi remains the owner of messages and scheduling. */
type Call = () => unknown;
type AssistantState = {
	lastMessage?: unknown;
	isStreaming?: boolean;
	hasToolCalls?: boolean;
	contentContainer?: unknown;
};
type Message = { content: { type: string }[]; stopReason?: string };

export class AssistantPresentationBuffer {
	enabled = false;
	private readonly pending = new Map<object, Call>();

	update(instance: object, args: unknown[], call: Call): unknown {
		const state = instance as AssistantState;
		const message = args[0] as Message | undefined;
		// Only explicit streaming updates are deferred. Internal invalidate/theme/
		// thinking setters omit the streaming argument and must rebuild immediately.
		if (
			!this.enabled ||
			args[1] !== true ||
			!state.lastMessage ||
			!state.contentContainer ||
			!message ||
			!Array.isArray(message.content) ||
			message.stopReason === "aborted" ||
			message.stopReason === "error" ||
			message.stopReason === "length"
		) {
			this.pending.delete(instance);
			return call();
		}
		state.lastMessage = message;
		state.isStreaming = true;
		state.hasToolCalls = message.content.some((part) => part.type === "toolCall");
		this.pending.set(instance, call);
		// Bound retained component references even if no render is requested.
		if (this.pending.size > 128) this.flush(this.pending.keys().next().value as object);
		return undefined;
	}

	render(instance: object, _width: unknown, call: Call): unknown {
		this.flush(instance);
		return call();
	}

	flush(instance: object): void {
		const call = this.pending.get(instance);
		this.pending.delete(instance);
		call?.();
	}

	flushAll(): void {
		for (const instance of this.pending.keys()) this.flush(instance);
	}

	dispose(): void {
		this.enabled = false;
		try {
			this.flushAll();
		} finally {
			this.pending.clear();
		}
	}
}
