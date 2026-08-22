"""
Audience Fit Agent — does this creator's audience match what the brand wants?
Checks niche match and follower-tier fit against the brand's expectations.
"""
from app.config import call_llm_json
from app.state import DealState


def run(state: DealState) -> dict:
    followers = state.get("followers_count")
    followers_str = f"{followers:,}" if followers else "unknown"

    prompt = f"""You are the Audience Fit Agent in a creator-brand deal evaluation system.

Creator:
- Platform: {state.get('platform')}
- Niche: {state.get('niche') or 'unclassified'}
- Followers: {followers_str}

Brand:
- Name: {state.get('brand_name')}
- Target niche: {state.get('brand_target_niche')}
- Platform preference: {state.get('brand_platform_preference')}

Evaluate how well this creator's audience fits the brand's target audience.
Consider: niche alignment, follower count appropriateness, platform match.

Respond ONLY with valid JSON, no markdown, no preamble:
{{
  "score": <0-100>,
  "verdict_component": "<strong fit | moderate fit | weak fit>",
  "reasoning": "<2-3 sentences>",
  "confidence": <0.0-1.0>
}}"""
    result = call_llm_json(prompt)
    return {"audience_fit_result": result}
