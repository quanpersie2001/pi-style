import { Theme, type ThemeColor } from "@earendil-works/pi-coding-agent";

export interface FakeThemeOptions {
	name?: string;
	colors?: Partial<Record<ThemeColor, string>>;
}

export function createFakeTheme(options: FakeThemeOptions = {}): Theme {
	const colors = options.colors ?? {};
	const foregroundTokens: ThemeColor[] = [
		"accent",
		"border",
		"borderAccent",
		"borderMuted",
		"success",
		"error",
		"warning",
		"muted",
		"dim",
		"text",
		"thinkingText",
		"userMessageText",
		"customMessageText",
		"customMessageLabel",
		"toolTitle",
		"toolOutput",
		"mdHeading",
		"mdLink",
		"mdLinkUrl",
		"mdCode",
		"mdCodeBlock",
		"mdCodeBlockBorder",
		"mdQuote",
		"mdQuoteBorder",
		"mdHr",
		"mdListBullet",
		"toolDiffAdded",
		"toolDiffRemoved",
		"toolDiffContext",
		"syntaxComment",
		"syntaxKeyword",
		"syntaxFunction",
		"syntaxVariable",
		"syntaxString",
		"syntaxNumber",
		"syntaxType",
		"syntaxOperator",
		"syntaxPunctuation",
		"thinkingOff",
		"thinkingMinimal",
		"thinkingLow",
		"thinkingMedium",
		"thinkingHigh",
		"thinkingXhigh",
		"thinkingMax",
		"bashMode",
	];
	const foregrounds = Object.fromEntries(foregroundTokens.map((token) => [token, colors[token] ?? ""])) as Record<
		ThemeColor,
		string
	>;
	const backgrounds = {
		selectedBg: "",
		userMessageBg: "",
		customMessageBg: "",
		toolPendingBg: "",
		toolSuccessBg: "",
		toolErrorBg: "",
	};
	return new Theme(foregrounds, backgrounds, "truecolor", { name: options.name ?? "fake" });
}
