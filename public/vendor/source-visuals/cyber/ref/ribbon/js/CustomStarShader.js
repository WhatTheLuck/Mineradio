CustomStarShader = {
uniforms: {
	texturePrimary:   { type: "t"},
	textureSpectral: { type: "t"},
	power: { type: "f", value: 1.0 },
	spectralLookup: { type: "f", value: 0 }			
},

attributes: {
	'size': { type: 'f', value: []},
	'opacity': { type: 'f', value: []}
},

	vertexShader: [
		'varying vec2 vUv;',
		'attribute float size;',
		'attribute float opacity;',

		'varying float vOpacity;',
		
		'void main() {',
			'vOpacity = opacity;',
			'vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );',
			'gl_PointSize = size * ( 300.0 / length( mvPosition.xyz ) );',
			'gl_Position = projectionMatrix * mvPosition;',
			'vUv = uv;',
		'}'

	].join("\n"),

	fragmentShader: [
		'varying vec2 vUv;',
		'varying float vOpacity;',
		'uniform float power;',

		'uniform sampler2D texturePrimary;',

		'uniform float spectralLookup;',
		'uniform sampler2D textureSpectral;',

		'void main() {',
			'vec2 uv = gl_PointCoord;',
	
			'vec4 foundColor = texture2D( texturePrimary, uv );',
			'vec4 alpha = texture2D( texturePrimary, uv ).aaaa;',
			//'foundColor.x *= 1.4;',
			//'foundColor.y *= 1.2;',
			//'foundColor.z *= 0.7;',
			//foundColor.xyz *= 10.0;
			'foundColor = clamp( foundColor, 0., 1. );',	

			'float spectralLookupClamped = clamp( spectralLookup, 0., 1. );',
			'vec2 spectralLookupUV = vec2( 0., spectralLookupClamped );',
			'vec4 spectralColor = texture2D( textureSpectral, spectralLookupUV );',	
			'spectralColor = clamp(spectralColor, 0., 1.);',
			
			//'float finalPower = clamp(power, 1., 15.);',
			'spectralColor.x = pow( spectralColor.x, 2.);',
			'spectralColor.y = pow( spectralColor.y, 2.);',
			'spectralColor.z = pow( spectralColor.z, 2.);',

			'spectralColor.xyz += 0.2;',
			
			'float finalPower = clamp(power, 1., 99.);',
			'vec3 finalColor = clamp( foundColor.xyz * finalPower, 0., 15.);',

			'gl_FragColor = alpha*vec4(finalColor, vOpacity * power);',

		'}'
	].join("\n")

};